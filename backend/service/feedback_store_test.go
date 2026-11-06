package service

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/AnTengye/contractdiff/backend/model"
)

func TestFeedbackStoreRestartIsolationAndConflicts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "feedback.db")
	s, err := NewFeedbackStore(path)
	if err != nil {
		t.Fatal(err)
	}
	f := &model.Feedback{ID: "case-1", Tenant: "a", Reporter: "user", Description: "missing amount", SnapshotKey: "feedback/a/case-1/snapshot.json", Files: map[string]string{"left_pdf": "feedback/a/case-1/left-pdf"}}
	if err = s.Create(f); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = NewFeedbackStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err = s.Get("b", f.ID); !errors.Is(err, ErrFeedbackNotFound) {
		t.Fatal("cross-tenant feedback accessible")
	}
	got, err := s.Get("a", f.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.SnapshotKey != f.SnapshotKey || got.Files["left_pdf"] != f.Files["left_pdf"] || len(got.Events) != 1 {
		t.Fatal("restart lost case evidence")
	}
	got.Status = "reproduced"
	if err = s.Update(got, "analyst", "reproduced with source files", 1); err != nil {
		t.Fatal(err)
	}
	if err = s.Update(got, "analyst", "stale update", 1); !errors.Is(err, ErrFeedbackConflict) {
		t.Fatal("stale write overwrote analysis")
	}
	got, err = s.Get("a", f.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != 2 || len(got.Events) != 2 {
		t.Fatal("analysis history is inconsistent")
	}
}

func TestParserCacheSeparatesVersionsAndRejectsPending(t *testing.T) {
	s := newTestStore(10)
	f := &model.Contract{ID: "v1", Tenant: "a", FileHash: "hash", ParserSignature: "mineru-v1", Status: model.StatusPending, CreatedAt: time.Now(), JSONData: map[string]interface{}{"paragraphs": "data"}}
	s.Save(f)
	if s.FindParsed("a", "hash", "mineru-v1") != nil {
		t.Fatal("pending result reused")
	}
	f.Status = model.StatusCompleted
	s.Save(f)
	if s.FindParsed("a", "hash", "paddle-v1") != nil || s.FindParsed("b", "hash", "mineru-v1") != nil {
		t.Fatal("cross-version or tenant cache reuse")
	}
	if s.FindParsed("a", "hash", "mineru-v1") == nil {
		t.Fatal("matching completed result not reused")
	}
	s.InvalidateCache("a", "hash")
	if s.FindParsed("a", "hash", "mineru-v1") != nil {
		t.Fatal("cache invalidation failed")
	}
}
