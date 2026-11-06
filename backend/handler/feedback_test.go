package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/middleware"
	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/gin-gonic/gin"
)

type memoryFeedbackArtifacts struct {
	files map[string][]byte
	fail  bool
}

func (m *memoryFeedbackArtifacts) UploadFile(_ context.Context, k string, r io.Reader, _ int64, _ string) error {
	if m.fail {
		return errors.New("storage unavailable")
	}
	b, err := io.ReadAll(r)
	m.files[k] = b
	return err
}
func (m *memoryFeedbackArtifacts) CopyFile(_ context.Context, from, to string) error {
	if m.fail {
		return errors.New("storage unavailable")
	}
	b, ok := m.files[from]
	if !ok {
		return errors.New("source missing")
	}
	m.files[to] = append([]byte(nil), b...)
	return nil
}
func (m *memoryFeedbackArtifacts) OpenFile(_ context.Context, k string) (io.ReadCloser, string, error) {
	b, ok := m.files[k]
	if !ok {
		return nil, "", errors.New("missing")
	}
	return io.NopCloser(bytes.NewReader(b)), "application/json", nil
}
func (m *memoryFeedbackArtifacts) DeleteFile(_ context.Context, k string) error {
	delete(m.files, k)
	return nil
}

func TestFeedbackRedactsEmbeddedCredentials(t *testing.T) {
	input := map[string]interface{}{
		"api_key":  "must-not-persist",
		"html":     `<img src="https://user:must-not-persist@example.test/image?signature=must-not-persist&amp;expires=10">`,
		"markdown": `Document: [image](https://example.test/image?token=must-not-persist)`,
		"business": `Pay at https://pay.example/checkout?amount=100&currency=CNY#invoice-1`,
	}
	encoded, err := json.Marshal(redactValue(input))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "must-not-persist") || strings.Contains(string(encoded), "api_key") {
		t.Fatal("embedded credentials persisted in feedback")
	}
	if !strings.Contains(string(encoded), "example.test/image") || !strings.Contains(string(encoded), "Document:") {
		t.Fatal("redaction lost the document context")
	}
	if !strings.Contains(string(encoded), "amount=100") || !strings.Contains(string(encoded), "invoice-1") {
		t.Fatal("redaction changed a business URL")
	}
}

func feedbackTestRouter(t *testing.T) (*gin.Engine, *FeedbackHandler, *memoryFeedbackArtifacts, func(string, string, string, string, interface{}) *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	s, err := service.NewFeedbackStore(filepath.Join(t.TempDir(), "feedback.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	cfg := &config.Config{Auth: config.AuthConfig{JWTSecret: "feedback-test-key", TokenExpireHours: 1}, Feedback: config.FeedbackConfig{Reviewers: []string{"analyst"}}}
	artifacts := &memoryFeedbackArtifacts{files: map[string][]byte{"source-a": []byte("source bytes")}}
	contracts := service.GetContractStore()
	id := "feedback-contract-" + t.Name()
	contracts.Save(&model.Contract{ID: id, Tenant: "tenant-a", Filename: "source.pdf", OriginalFormat: "pdf", FileObjectKey: "source-a", FileHash: "sha", Status: model.StatusCompleted, ParserType: "paddleocr", CreatedAt: time.Now(), JSONData: map[string]interface{}{"paragraphs": []interface{}{map[string]interface{}{"text": "金额100元", "page": 1}}}, RawJSONData: map[string]interface{}{"token": "must-not-persist", "result_url": "https://example.test/result?signature=must-not-persist"}})
	t.Cleanup(func() { contracts.Delete(id) })
	h := NewFeedbackHandler(s, contracts, artifacts, cfg)
	r := gin.New()
	r.Use(middleware.AuthMiddleware(&cfg.Auth))
	r.POST("/feedback", h.Create)
	r.GET("/feedback", h.List)
	r.GET("/feedback/:id", h.Get)
	r.PUT("/feedback/:id", h.Update)
	r.GET("/feedback/:id/artifacts/:artifact", h.Artifact)
	r.GET("/feedback/:id/regression", h.Regression)
	request := func(method, path, user, tenant string, body interface{}) *httptest.ResponseRecorder {
		encoded, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(encoded))
		req.Header.Set("Content-Type", "application/json")
		token, _, err := middleware.GenerateToken(user, tenant, &cfg.Auth)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	return r, h, artifacts, request
}

func TestFeedbackArchiveWorkflowAndIsolation(t *testing.T) {
	_, h, artifacts, request := feedbackTestRouter(t)
	id := "feedback-contract-" + t.Name()
	w := request("POST", "/feedback", "reporter", "tenant-a", CreateFeedbackRequest{Category: "missed", Description: "decimal change missing", Expected: "one change", LeftID: id, Comparison: json.RawMessage(`{"authorization":"must-not-persist","metadata":{"engineVersion":"structured-v3"}}`)})
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var f model.Feedback
	if err := json.Unmarshal(w.Body.Bytes(), &f); err != nil {
		t.Fatal(err)
	}
	stored, err := h.store.Get("tenant-a", f.ID)
	if err != nil {
		t.Fatal(err)
	}
	if string(artifacts.files[stored.Files["left_original"]]) != "source bytes" {
		t.Fatal("source evidence not copied")
	}
	if strings.Contains(string(artifacts.files[stored.SnapshotKey]), "must-not-persist") {
		t.Fatal("credentials persisted in snapshot")
	}
	if strings.Contains(w.Body.String(), "snapshot_key") || strings.Contains(w.Body.String(), "source-a") {
		t.Fatal("object keys exposed in response")
	}
	for _, who := range [][2]string{{"reporter", "tenant-b"}, {"other", "tenant-a"}} {
		if got := request("GET", "/feedback/"+f.ID, who[0], who[1], nil); got.Code != 404 {
			t.Fatal("unauthorized feedback read")
		}
	}
	if got := request("PUT", "/feedback/"+f.ID, "reporter", "tenant-a", map[string]interface{}{"status": "reproduced", "note": "test", "revision": 1}); got.Code != 403 {
		t.Fatal("reporter promoted own analysis state")
	}
	if got := request("PUT", "/feedback/"+f.ID, "analyst", "tenant-a", map[string]interface{}{"status": "verified", "note": "skip steps", "revision": 1}); got.Code != 400 {
		t.Fatal("unverified case accepted")
	}
	for _, status := range []string{"reproduced", "diagnosed", "fixed", "verified"} {
		body := map[string]interface{}{"status": status, "note": "analyzed against source", "revision": f.Revision, "resolution_version": "local-fix", "regression": map[string]interface{}{"left_text": "金额100元"}}
		got := request("PUT", "/feedback/"+f.ID, "analyst", "tenant-a", body)
		if got.Code != 200 {
			t.Fatalf("update %s: %s", status, got.Body.String())
		}
		if err = json.Unmarshal(got.Body.Bytes(), &f); err != nil {
			t.Fatal(err)
		}
	}
	if len(f.Events) != 5 || f.ResolutionVersion != "local-fix" {
		t.Fatal("analysis history not retained")
	}
	got := request("GET", "/feedback/"+f.ID+"/regression", "analyst", "tenant-a", nil)
	if got.Code != 200 || !strings.Contains(got.Body.String(), "regression-v1") {
		t.Fatalf("regression export: %s", got.Body.String())
	}
	if got = request("GET", "/feedback/"+f.ID+"/regression", "reporter", "tenant-a", nil); got.Code != 403 {
		t.Fatal("regression export lacked analysis authorization")
	}
	h.contracts.Delete(id)
	got = request("GET", "/feedback/"+f.ID+"/artifacts/snapshot", "reporter", "tenant-a", nil)
	if got.Code != 200 || !strings.Contains(got.Body.String(), "金额100元") {
		t.Fatal("contract deletion lost feedback evidence")
	}
	got = request("PUT", "/feedback/"+f.ID, "analyst", "tenant-a", map[string]interface{}{"status": "diagnosed", "note": "stale", "revision": 1})
	if got.Code != 409 {
		t.Fatal("stale analysis overwrote latest record")
	}
}

func TestFeedbackValidatesRegionAndStorageFailure(t *testing.T) {
	_, h, artifacts, request := feedbackTestRouter(t)
	id := "feedback-contract-" + t.Name()
	base := CreateFeedbackRequest{Category: "highlight", Description: "offset", LeftID: id}
	base.Region = &model.FeedbackRegion{Side: "left", Page: 1, BBox: []float64{100, 0, 10, 20}}
	if got := request("POST", "/feedback", "reporter", "tenant-a", base); got.Code != 400 {
		t.Fatal("invalid region accepted")
	}
	base.Region = nil
	artifacts.fail = true
	if got := request("POST", "/feedback", "reporter", "tenant-a", base); got.Code != 500 {
		t.Fatal("failed archive presented as success")
	}
	items, err := h.store.List("tenant-a", "")
	if err != nil || len(items) != 0 {
		t.Fatal("incomplete archive inserted")
	}
}
