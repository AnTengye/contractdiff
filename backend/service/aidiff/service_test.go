package aidiff

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
)

type controlledCompleter struct {
	started chan Input
	finish  chan error
}

func (c controlledCompleter) Compare(ctx context.Context, input Input) (ModelResult, error) {
	c.started <- input
	select {
	case err := <-c.finish:
		return ModelResult{Complete: true, Differences: []ModelFinding{}}, err
	case <-ctx.Done():
		return ModelResult{}, ctx.Err()
	}
}
func awaitFinished(t *testing.T, s *Service, owner, id string) Job {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		job, _ := s.Get(owner, id)
		if job.FinishedAt != nil {
			return job
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("job did not finish")
	return Job{}
}
func TestAsyncOwnerIsolationCacheAndFallback(t *testing.T) {
	s := New(config.AIDiffConfig{APIKey: "test-only"}, nil)
	defer s.Close()
	c := controlledCompleter{make(chan Input, 2), make(chan error, 2)}
	s.completer = c
	left, right := sourceContract("金额1.50元"), sourceContract("金额15.0元")
	job, err := s.Start("tenant/user", left, right, Options{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != "queued" {
		t.Fatalf("POST blocked on inference: %+v", job)
	}
	<-c.started
	reused, err := s.Start("tenant/user", left, right, Options{}, nil)
	if err != nil || reused.ID != job.ID {
		t.Fatal("active inference not deduplicated")
	}
	if _, ok := s.Get("other/user", job.ID); ok {
		t.Fatal("cross-owner access")
	}
	s.update(job.ID, func(j *Job) {
		j.Findings = append(j.Findings, Finding{ID: "native", Category: "format", Source: "native_style"})
	})
	c.finish <- errors.New("AI unavailable")
	failed := awaitFinished(t, s, "tenant/user", job.ID)
	if failed.Status != "partial" || len(failed.Findings) != 1 {
		t.Fatalf("native fallback lost: %+v", failed)
	}
	retry, err := s.Start("tenant/user", left, right, Options{}, nil)
	if err != nil || retry.ID == job.ID {
		t.Fatal("failed inference cannot retry")
	}
	<-c.started
	c.finish <- nil
	completed := awaitFinished(t, s, "tenant/user", retry.ID)
	if completed.Status != "completed" {
		t.Fatal(completed.Status)
	}
	cached, _ := s.Start("tenant/user", left, right, Options{}, nil)
	if cached.ID != retry.ID {
		t.Fatal("completed inference not cached")
	}
	s.update(cached.ID, func(job *Job) { job.CreatedAt = time.Now().Add(-2 * time.Hour) })
	if _, ok := s.Get("tenant/user", cached.ID); ok {
		t.Fatal("expired job remained readable")
	}
	changed, _ := s.Start("tenant/user", left, right, Options{IgnorePunctuation: true}, nil)
	if changed.ID == cached.ID {
		t.Fatal("cache ignores punctuation option")
	}
}
