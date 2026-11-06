package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/middleware"
	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type FeedbackArtifacts interface {
	UploadFile(context.Context, string, io.Reader, int64, string) error
	CopyFile(context.Context, string, string) error
	OpenFile(context.Context, string) (io.ReadCloser, string, error)
	DeleteFile(context.Context, string) error
}

type FeedbackHandler struct {
	store     *service.FeedbackStore
	contracts *service.ContractStore
	artifacts FeedbackArtifacts
	cfg       *config.Config
}

func NewFeedbackHandler(store *service.FeedbackStore, contracts *service.ContractStore, artifacts FeedbackArtifacts, cfg *config.Config) *FeedbackHandler {
	return &FeedbackHandler{store: store, contracts: contracts, artifacts: artifacts, cfg: cfg}
}

func CanReviewFeedback(cfg *config.Config, username string) bool {
	for _, name := range cfg.Feedback.Reviewers {
		if name == username {
			return true
		}
	}
	return false
}

type CreateFeedbackRequest struct {
	Category     string                `json:"category"`
	Description  string                `json:"description"`
	Expected     string                `json:"expected"`
	LeftID       string                `json:"left_id"`
	RightID      string                `json:"right_id"`
	ComparisonID string                `json:"comparison_id"`
	Comparison   json.RawMessage       `json:"comparison"`
	Region       *model.FeedbackRegion `json:"region"`
}

func (h *FeedbackHandler) Create(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20)
	var req CreateFeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "反馈数据格式错误或超过 16MB"})
		return
	}
	validCategories := map[string]bool{"missed": true, "false_positive": true, "ocr": true, "table": true, "highlight": true, "performance": true, "failure": true}
	if !validCategories[req.Category] || len(strings.TrimSpace(req.Description)) == 0 || len(req.Description) > 8000 || len(req.Expected) > 8000 || (req.LeftID == "" && req.RightID == "") || len(req.ComparisonID) > 128 {
		c.JSON(400, gin.H{"error": "请选择问题类型并填写说明，至少关联一份文档"})
		return
	}
	if r := req.Region; r != nil {
		if (r.Side != "left" && r.Side != "right") || r.Page < 1 || r.Page > 100000 || len(r.Text) > 8000 || (len(r.BBox) != 0 && len(r.BBox) != 4) {
			c.JSON(400, gin.H{"error": "反馈位置无效"})
			return
		}
		for _, n := range r.BBox {
			if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 {
				c.JSON(400, gin.H{"error": "反馈坐标无效"})
				return
			}
		}
		if len(r.BBox) == 4 && (r.BBox[2] < r.BBox[0] || r.BBox[3] < r.BBox[1]) {
			c.JSON(400, gin.H{"error": "反馈坐标无效"})
			return
		}
		if (r.Side == "left" && req.LeftID == "") || (r.Side == "right" && req.RightID == "") {
			c.JSON(400, gin.H{"error": "反馈位置对应的文档不存在"})
			return
		}
	}
	tenant := middleware.GetTenant(c)
	contracts := map[string]*model.Contract{}
	for side, id := range map[string]string{"left": req.LeftID, "right": req.RightID} {
		if id == "" {
			continue
		}
		contract := h.contracts.Get(id)
		if contract == nil || contract.Tenant != tenant {
			c.JSON(404, gin.H{"error": "关联文档不存在"})
			return
		}
		contracts[side] = contract
	}
	f := &model.Feedback{ID: uuid.NewString(), Tenant: tenant, Reporter: middleware.GetUsername(c), Category: req.Category, Description: strings.TrimSpace(req.Description), Expected: req.Expected, LeftID: req.LeftID, RightID: req.RightID, ComparisonID: req.ComparisonID, Region: req.Region, Files: map[string]string{}}
	prefix := "feedback/" + tenant + "/" + f.ID + "/"
	snapshot := model.FeedbackSnapshot{SchemaVersion: "feedback-v1", CreatedAt: time.Now().UTC(), Documents: map[string]model.FeedbackDocument{}, Comparison: redactJSON(req.Comparison)}
	created := []string{}
	saved := false
	defer func() {
		if !saved {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			for _, key := range created {
				if err := h.artifacts.DeleteFile(ctx, key); err != nil {
					slog.Warn("feedback artifact cleanup failed", "case_id", f.ID, "error", err)
				}
			}
		}
	}()
	for side, contract := range contracts {
		snapshot.Documents[side] = model.FeedbackDocument{
			ID: contract.ID, Filename: contract.Filename, OriginalFormat: contract.OriginalFormat,
			FileHash: contract.FileHash, PDFHash: contract.PDFHash,
			ParserType: contract.ParserType, ParserVersion: contract.ParserVersion,
			ParserSignature:      contract.ParserSignature,
			ProcessingSignature:  contract.ProcessingSignature,
			ResultSignature:      contract.ResultSignature,
			ConversionRevision:   contract.ConversionRevision,
			ParserSettings:       redactValue(contract.ParserSettings).(map[string]interface{}),
			NormalizationVersion: contract.NormalizationVersion,
			Status:               contract.Status, Error: redactValue(contract.ErrorMsg).(string),
			FailureStage:       contract.FailureStage,
			CoordinateStatus:   contract.CoordinateStatus,
			CoordinateWarnings: append([]string(nil), contract.CoordinateWarnings...),
			TaskID:             contract.TaskID, RequestID: contract.RequestID, TraceID: contract.TraceID,
			Data: redactValue(contract.JSONData), RawData: redactValue(contract.RawJSONData),
			Metadata: contract.Metadata,
		}
		for kind, source := range map[string]string{"original": contract.FileObjectKey, "pdf": contract.PDFObjectKey} {
			if kind == "pdf" && source == "" && contract.OriginalFormat == "pdf" {
				// An old original-PDF record may not have populated PDFObjectKey;
				// its original object is still the actual PDF. Never apply this
				// fallback to DOCX, whose original object is not a preview PDF.
				source = contract.FileObjectKey
			}
			if source == "" {
				if kind == "original" || contract.Status == model.StatusCompleted {
					c.JSON(409, gin.H{"error": "旧文档缺少持久文件引用，请重新上传后反馈"})
					return
				}
				continue
			}
			key := prefix + side + "-" + kind
			if kind == "pdf" {
				key += ".pdf"
			} else if contract.OriginalFormat == "pdf" || contract.OriginalFormat == "docx" {
				key += "." + contract.OriginalFormat
			}
			created = append(created, key)
			if err := h.artifacts.CopyFile(c.Request.Context(), source, key); err != nil {
				h.failure(c, "保存反馈文件失败", err)
				return
			}
			f.Files[side+"_"+kind] = key
		}
	}
	body, err := json.Marshal(snapshot)
	if err != nil {
		h.failure(c, "生成反馈快照失败", err)
		return
	}
	f.SnapshotKey = prefix + "snapshot.json"
	created = append(created, f.SnapshotKey)
	if err = h.artifacts.UploadFile(c.Request.Context(), f.SnapshotKey, bytes.NewReader(body), int64(len(body)), "application/json"); err != nil {
		h.failure(c, "保存反馈快照失败", err)
		return
	}
	if err = h.store.Create(f); err != nil {
		h.failure(c, "保存反馈记录失败", err)
		return
	}
	saved = true
	c.JSON(http.StatusCreated, f)
}

func (h *FeedbackHandler) List(c *gin.Context) {
	reporter := middleware.GetUsername(c)
	if CanReviewFeedback(h.cfg, reporter) {
		reporter = ""
	}
	items, err := h.store.List(middleware.GetTenant(c), reporter)
	if err != nil {
		h.failure(c, "读取反馈失败", err)
		return
	}
	c.JSON(200, gin.H{"feedback": items})
}

func (h *FeedbackHandler) authorized(c *gin.Context) *model.Feedback {
	f, err := h.store.Get(middleware.GetTenant(c), c.Param("id"))
	if errors.Is(err, service.ErrFeedbackNotFound) {
		c.JSON(404, gin.H{"error": "反馈不存在"})
		return nil
	}
	if err != nil {
		h.failure(c, "读取反馈失败", err)
		return nil
	}
	if f.Reporter != middleware.GetUsername(c) && !CanReviewFeedback(h.cfg, middleware.GetUsername(c)) {
		c.JSON(404, gin.H{"error": "反馈不存在"})
		return nil
	}
	return f
}

func (h *FeedbackHandler) Get(c *gin.Context) {
	if f := h.authorized(c); f != nil {
		c.JSON(200, f)
	}
}

func (h *FeedbackHandler) Update(c *gin.Context) {
	if !CanReviewFeedback(h.cfg, middleware.GetUsername(c)) {
		c.JSON(403, gin.H{"error": "需要反馈分析权限"})
		return
	}
	f := h.authorized(c)
	if f == nil {
		return
	}
	var req struct {
		Status            string                       `json:"status"`
		Note              string                       `json:"note"`
		Revision          int                          `json:"revision"`
		ResolutionVersion string                       `json:"resolution_version"`
		Regression        *model.RegressionExpectation `json:"regression"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Note) == "" || len(req.Note) > 8000 || len(req.ResolutionVersion) > 128 {
		c.JSON(400, gin.H{"error": "请填写分析或处理记录"})
		return
	}
	allowed := map[string]map[string]bool{"new": {"reproduced": true, "closed": true}, "reproduced": {"diagnosed": true, "closed": true}, "diagnosed": {"fixed": true, "closed": true}, "fixed": {"verified": true, "diagnosed": true}, "verified": {"diagnosed": true}, "closed": {"reproduced": true}}
	if req.Status != f.Status && !allowed[f.Status][req.Status] {
		c.JSON(400, gin.H{"error": "处理状态顺序无效"})
		return
	}
	if req.Status == "fixed" && strings.TrimSpace(req.ResolutionVersion) == "" {
		c.JSON(400, gin.H{"error": "修复时需填写修复版本"})
		return
	}
	if req.Status == "verified" && (req.Regression == nil || (req.Regression.TotalChanges == nil && req.Regression.LeftText == "" && req.Regression.RightText == "")) {
		c.JSON(400, gin.H{"error": "验证时需标注回归预期"})
		return
	}
	if req.Regression != nil && ((req.Regression.TotalChanges != nil && *req.Regression.TotalChanges < 0) || len(req.Regression.LeftText) > 8000 || len(req.Regression.RightText) > 8000) {
		c.JSON(400, gin.H{"error": "回归预期无效"})
		return
	}
	f.Status = req.Status
	if req.ResolutionVersion != "" {
		f.ResolutionVersion = req.ResolutionVersion
	}
	if req.Regression != nil {
		f.Regression = req.Regression
	}
	if err := h.store.Update(f, middleware.GetUsername(c), req.Note, req.Revision); err != nil {
		if errors.Is(err, service.ErrFeedbackConflict) {
			c.JSON(409, gin.H{"error": "反馈已被更新，请重新打开案例后再保存"})
			return
		}
		h.failure(c, "更新反馈失败", err)
		return
	}
	f, err := h.store.Get(f.Tenant, f.ID)
	if err != nil {
		h.failure(c, "读取更新结果失败", err)
		return
	}
	c.JSON(200, f)
}

func (h *FeedbackHandler) Artifact(c *gin.Context) {
	f := h.authorized(c)
	if f == nil {
		return
	}
	name := c.Param("artifact")
	key := f.Files[name]
	if name == "snapshot" {
		key = f.SnapshotKey
	}
	if key == "" {
		c.JSON(404, gin.H{"error": "反馈附件不存在"})
		return
	}
	r, contentType, err := h.artifacts.OpenFile(c.Request.Context(), key)
	if err != nil {
		h.failure(c, "读取附件失败", err)
		return
	}
	defer r.Close()
	c.Header("Content-Type", contentType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-%s\"", f.ID, name+filepath.Ext(key)))
	if _, err = io.Copy(c.Writer, r); err != nil {
		slog.Warn("feedback download interrupted", "case_id", f.ID, "error", err)
	}
}

func (h *FeedbackHandler) Regression(c *gin.Context) {
	f := h.authorized(c)
	if f == nil {
		return
	}
	if !CanReviewFeedback(h.cfg, middleware.GetUsername(c)) {
		c.JSON(403, gin.H{"error": "需要反馈分析权限"})
		return
	}
	if f.Status != "verified" || f.Regression == nil {
		c.JSON(409, gin.H{"error": "案例验证并标注预期后才能导出回归样例"})
		return
	}
	r, _, err := h.artifacts.OpenFile(c.Request.Context(), f.SnapshotKey)
	if err != nil {
		h.failure(c, "读取回归快照失败", err)
		return
	}
	defer r.Close()
	var snapshot model.FeedbackSnapshot
	if err = json.NewDecoder(io.LimitReader(r, 64<<20)).Decode(&snapshot); err != nil {
		h.failure(c, "读取回归快照失败", err)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"feedback-%s.json\"", f.ID))
	c.JSON(200, gin.H{"schema_version": "regression-v1", "case": f, "snapshot": snapshot, "expectation": f.Regression})
}

func (h *FeedbackHandler) failure(c *gin.Context, message string, err error) {
	slog.Error("feedback operation failed", "request_id", middleware.GetRequestID(c), "error", err)
	c.JSON(500, gin.H{"error": message})
}

func redactJSON(b json.RawMessage) json.RawMessage {
	if len(b) == 0 {
		return nil
	}
	var v interface{}
	if json.Unmarshal(b, &v) != nil {
		return nil
	}
	out, _ := json.Marshal(redactValue(v))
	return out
}

var feedbackURLs = regexp.MustCompile(`https?://[^\s<>"'()\[\]]+`)

var credentialURLFields = map[string]bool{
	"file_url":           true,
	"pdf_url":            true,
	"converted_file_url": true,
	"download_url":       true,
	"json_url":           true,
	"md_url":             true,
	"result_url":         true,
	"presigned_url":      true,
	"signed_url":         true,
}

func isCredentialURLField(key string) bool {
	key = strings.ToLower(key)
	if credentialURLFields[key] {
		return true
	}
	return strings.Contains(key, "presign") || strings.Contains(key, "signed_url")
}

func isCredentialURLParam(key string) bool {
	key = strings.ToLower(strings.TrimPrefix(key, "amp;"))
	return strings.Contains(key, "token") || strings.Contains(key, "secret") ||
		strings.Contains(key, "signature") || strings.Contains(key, "credential") ||
		strings.HasSuffix(key, "_sig") || key == "sig" || key == "expires" ||
		strings.HasPrefix(key, "x-amz-")
}

func isCredentialFragment(fragment string) bool {
	fragment = strings.ToLower(fragment)
	return strings.Contains(fragment, "token") || strings.Contains(fragment, "secret") ||
		strings.Contains(fragment, "signature") || strings.Contains(fragment, "credential")
}

func redactValue(v interface{}) interface{} {
	return redactValueWithField(v, "")
}

func redactValueWithField(v interface{}, field string) interface{} {
	switch x := v.(type) {
	case map[string]interface{}:
		out := map[string]interface{}{}
		for k, value := range x {
			lower := strings.ToLower(k)
			if strings.Contains(lower, "token") || strings.Contains(lower, "secret") || strings.Contains(lower, "password") || lower == "authorization" || lower == "api_key" || lower == "apikey" {
				continue
			}
			out[k] = redactValueWithField(value, k)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(x))
		for i, value := range x {
			out[i] = redactValueWithField(value, field)
		}
		return out
	case string:
		return feedbackURLs.ReplaceAllStringFunc(x, func(raw string) string {
			if u, err := url.Parse(raw); err == nil && u.Host != "" {
				stripAll := isCredentialURLField(field)
				changed := false
				if u.User != nil {
					u.User = nil
					changed = true
				}
				if stripAll {
					u.RawQuery = ""
					u.Fragment = ""
					changed = true
				} else {
					query := u.Query()
					for key := range query {
						if isCredentialURLParam(key) {
							delete(query, key)
							changed = true
						}
					}
					if changed {
						u.RawQuery = query.Encode()
					}
					if isCredentialFragment(u.Fragment) {
						u.Fragment = ""
						changed = true
					}
				}
				if !changed {
					return raw
				}
				return u.String()
			}
			return raw
		})
	}
	return v
}
