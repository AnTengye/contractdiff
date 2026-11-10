package aidiff

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/google/uuid"
)

var ErrBusy = errors.New("AI 对比任务较多，请稍后重试；算法结果仍可使用")

type Files interface {
	OpenFile(context.Context, string) (io.ReadCloser, string, error)
}
type entry struct {
	job        Job
	owner, key string
	cancel     context.CancelFunc
	visualKeys map[string]bool
}
type Service struct {
	mu        sync.Mutex
	jobs      map[string]*entry
	slots     chan struct{}
	cfg       config.AIDiffConfig
	completer Completer
	files     Files
	ctx       context.Context
	cancel    context.CancelFunc
}

func New(cfg config.AIDiffConfig, files Files) *Service {
	if cfg.Model == "" {
		cfg.Model = "gpt-6-luna"
	}
	if cfg.Reasoning == "" {
		cfg.Reasoning = "medium"
	}
	if cfg.APIURL == "" {
		cfg.APIURL = "https://api.openai.com/v1"
	}
	if cfg.TimeoutSeconds <= 0 {
		cfg.TimeoutSeconds = 180
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Service{jobs: map[string]*entry{}, slots: make(chan struct{}, 2), cfg: cfg, completer: &OpenAI{Config: cfg}, files: files, ctx: ctx, cancel: cancel}
}
func (s *Service) Close()          { s.cancel() }
func (s *Service) Available() bool { return s.cfg.APIKey != "" }

func (s *Service) Start(owner string, left, right *model.Contract, options Options, hints []Hint) (Job, error) {
	if !s.Available() {
		return Job{}, errors.New("AI 服务未配置，算法结果仍可使用")
	}
	ldoc, err := Extract(left, "left", options)
	if err != nil {
		return Job{}, err
	}
	rdoc, err := Extract(right, "right", options)
	if err != nil {
		return Job{}, err
	}
	docs := map[string]Document{"left": ldoc, "right": rdoc}
	length := 0
	for _, doc := range docs {
		for _, unit := range doc.Units {
			length += len([]rune(unit.Text))
		}
	}
	if length > 120000 || len(ldoc.Units)+len(rdoc.Units) > 3000 {
		return Job{}, errors.New("文档超出 AI 单次比对范围，算法结果仍可使用")
	}
	// Hints are untrusted leads and are accepted only when quoted source text exists.
	clean := []Hint{}
	ltext, rtext := "", ""
	for _, u := range ldoc.Units {
		ltext += u.Text
	}
	for _, u := range rdoc.Units {
		rtext += u.Text
	}
	ltext, _, _ = compact(ltext)
	rtext, _, _ = compact(rtext)
	for _, h := range hints {
		before, _, _ := compact(h.Before)
		after, _, _ := compact(h.After)
		if len(h.Before)+len(h.After) <= 6000 && (before == "" || strings.Contains(ltext, before)) && (after == "" || strings.Contains(rtext, after)) {
			clean = append(clean, h)
		}
		if len(clean) >= 200 {
			break
		}
	}
	input := Input{docs, options, clean}
	identity, _ := json.Marshal([]any{Version, owner, s.cfg.Model, s.cfg.Reasoning, input, left.FileHash, right.FileHash})
	sum := sha256.Sum256(identity)
	key := hex.EncodeToString(sum[:])
	s.mu.Lock()
	active := 0
	for id, e := range s.jobs {
		if time.Since(e.job.CreatedAt) > time.Hour && e.job.FinishedAt != nil {
			delete(s.jobs, id)
			continue
		}
		if e.owner == owner && e.key == key && (e.job.Status == "completed" || e.job.Status == "queued" || e.job.Status == "running") {
			job := clone(e.job)
			s.mu.Unlock()
			return job, nil
		}
		if e.job.FinishedAt == nil {
			active++
		}
	}
	if active >= 8 {
		s.mu.Unlock()
		return Job{}, ErrBusy
	}
	// Evict completed entries first. Active jobs always have a deadline.
	if len(s.jobs) >= 64 {
		oldest := ""
		for id, e := range s.jobs {
			if e.job.FinishedAt != nil && (oldest == "" || e.job.CreatedAt.Before(s.jobs[oldest].job.CreatedAt)) {
				oldest = id
			}
		}
		if oldest == "" {
			s.mu.Unlock()
			return Job{}, ErrBusy
		}
		delete(s.jobs, oldest)
	}
	ctx, cancel := context.WithTimeout(s.ctx, time.Duration(s.cfg.TimeoutSeconds)*time.Second)
	job := Job{ID: uuid.NewString(), Status: "queued", TextStatus: "running", Phase: "等待 AI 识别", Model: s.cfg.Model, Reasoning: s.cfg.Reasoning, Documents: docs, Findings: []Finding{}, FormatStatus: "unavailable", Warnings: []string{}, CreatedAt: time.Now()}
	s.jobs[job.ID] = &entry{job: job, owner: owner, key: key, cancel: cancel}
	s.mu.Unlock()
	go s.run(ctx, job.ID, input, left, right)
	return job, nil
}

func clone(job Job) Job {
	data, _ := json.Marshal(job)
	var copied Job
	_ = json.Unmarshal(data, &copied)
	return copied
}
func (s *Service) Get(owner, id string) (Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.jobs[id]
	if !ok || e.owner != owner {
		return Job{}, false
	}
	if time.Since(e.job.CreatedAt) > time.Hour {
		if e.job.FinishedAt != nil {
			delete(s.jobs, id)
		}
		return Job{}, false
	}
	return clone(e.job), true
}

func (s *Service) update(id string, update func(*Job)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := s.jobs[id]; e != nil {
		update(&e.job)
	}
}

func (s *Service) run(ctx context.Context, id string, input Input, left, right *model.Contract) {
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if e := s.jobs[id]; e != nil {
			now := time.Now()
			e.job.FinishedAt = &now
			e.cancel()
		}
	}()
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		s.update(id, func(job *Job) {
			job.Status = "failed"
			job.TextStatus = "failed"
			job.Error = "AI 对比等待超时，算法结果仍可使用"
		})
		return
	}
	s.update(id, func(job *Job) { job.Status = "running"; job.Phase = "正在识别文字差异" })
	// Native formatting is independent of the AI request and remains available
	// when the model fails. Scan formatting requires explicit visual review.
	if left.OriginalFormat == "docx" && right.OriginalFormat == "docx" && s.files != nil {
		findings, err := s.nativeFormats(ctx, left, right, input.Documents)
		s.update(id, func(job *Job) {
			if err != nil {
				job.Warnings = append(job.Warnings, "原生格式复核未完成，文字结果仍可使用")
			} else {
				job.FormatStatus = "completed"
				job.Findings = append(job.Findings, findings...)
			}
		})
	}
	result, err := s.completer.Compare(ctx, input)
	if err != nil {
		s.update(id, func(job *Job) {
			job.Status = "failed"
			job.TextStatus = "failed"
			if len(job.Findings) > 0 {
				job.Status = "partial"
			}
			job.Error = err.Error()
			job.Phase = "AI 识别未完成"
		})
		slog.Warn("AI comparison unavailable", "job_id", id) // No upstream body, key or document text.
		return
	}
	s.update(id, func(job *Job) {
		seen := map[string]bool{}
		for _, item := range result.Differences {
			before, after := Resolve(item.Before, input.Documents["left"]), Resolve(item.After, input.Documents["right"])
			if item.Kind != "added" && item.Kind != "removed" && item.Kind != "modified" && item.Kind != "moved" {
				continue
			}
			if item.Before.Quote == "" && item.After.Quote == "" {
				continue
			}
			lquote, _, _ := compact(item.Before.Quote)
			rquote, _, _ := compact(item.After.Quote)
			if item.Kind == "modified" && lquote == rquote {
				structural := false
				for _, doc := range input.Documents {
					for _, unit := range doc.Units {
						if unit.Kind == "cell" {
							for _, id := range append(append([]string{}, item.Before.UnitIDs...), item.After.UnitIDs...) {
								if id == unit.ID {
									structural = true
								}
							}
						}
					}
				}
				if !structural {
					before.Status, after.Status = "unresolved", "unresolved"
					before.Reason, after.Reason = "AI 引文未包含文字变动，请核对原文", "AI 引文未包含文字变动，请核对原文"
					before.Candidates, after.Candidates = nil, nil
				}
			}
			identity, _ := json.Marshal([]any{item.Kind, before, after})
			if seen[string(identity)] {
				continue
			}
			seen[string(identity)] = true
			if (item.Kind == "added" && before.Status != "not_applicable") || (item.Kind == "removed" && after.Status != "not_applicable") || ((item.Kind == "modified" || item.Kind == "moved") && (before.Status == "not_applicable" || after.Status == "not_applicable")) {
				before.Status, after.Status = "unresolved", "unresolved"
				before.Reason, after.Reason = "变更类型与双侧引文不一致", "变更类型与双侧引文不一致"
				before.Candidates, after.Candidates = nil, nil
			}
			job.Findings = append(job.Findings, Finding{ID: fmt.Sprintf("%s-t%d", id, len(job.Findings)), Category: "text", Kind: item.Kind, Summary: item.Summary, Before: before, After: after, Source: "ai"})
		}
		job.Status, job.Phase = "completed", "AI 识别完成"
		job.TextStatus = "completed"
		for _, finding := range job.Findings {
			if finding.Before.Status == "unresolved" || finding.After.Status == "unresolved" {
				job.Status = "partial"
				job.Warnings = append(job.Warnings, "部分 AI 引文未通过定位核对，已保留为待确认项")
				break
			}
		}
		job.Warnings = append(job.Warnings, result.Notes...)
	})
}
