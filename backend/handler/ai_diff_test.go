package handler

import (
	"bytes"
	"net/http/httptest"
	"testing"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/AnTengye/contractdiff/backend/service/aidiff"
	"github.com/gin-gonic/gin"
)

func TestAIDiffTenantAndAvailability(t *testing.T) {
	store := setupTestStore()
	for _, doc := range []*model.Contract{
		{ID: "ai-owned", Tenant: "ai-tenant", PDFHash: "pdf", ResultSignature: "parse", Status: model.StatusCompleted, JSONData: map[string]any{"paragraphs": []any{map[string]any{"text": "金额100元"}}}},
		{ID: "ai-other", Tenant: "other-tenant", Status: model.StatusCompleted, JSONData: map[string]any{"paragraphs": []any{map[string]any{"text": "机密合同"}}}},
		{ID: "ai-pending", Tenant: "ai-tenant", Status: model.StatusProcessing},
	} {
		store.Save(doc)
		defer store.Delete(doc.ID)
	}
	ai := aidiff.New(config.AIDiffConfig{}, nil)
	defer ai.Close()
	h := NewAIDiffHandler(ai, store)
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("tenant", "ai-tenant"); c.Set("username", "ai-user") })
	router.POST("/ai-diff", h.Create)
	router.GET("/ai-diff/:id", h.Get)
	for _, test := range []struct {
		body   string
		status int
	}{
		{`{"left_id":"ai-owned","right_id":"ai-other"}`, 404},
		{`{"left_id":"ai-owned","right_id":"missing"}`, 404},
		{`{"left_id":"ai-owned","right_id":"ai-pending"}`, 409},
		{`{"left_id":"ai-owned","right_id":"ai-owned"}`, 503},
		{`{}`, 400},
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/ai-diff", bytes.NewBufferString(test.body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)
		if w.Code != test.status {
			t.Fatalf("%s: status %d %s", test.body, w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/ai-diff/unknown", nil))
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}
