package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/gin-gonic/gin"
)

func TestCallbackHandlerHandleCallback(t *testing.T) {
	store := service.GetContractStore()

	// Create a test contract
	contract := &model.Contract{
		ID:        "callback-test",
		Tenant:    "tenant1",
		Status:    model.StatusProcessing,
		CreatedAt: time.Now(),
	}
	store.Save(contract)

	handler := NewCallbackHandler(nil) // MineruService not needed for most tests

	tests := []struct {
		name           string
		body           map[string]interface{}
		expectedStatus int
	}{
		{
			name: "done callback",
			body: map[string]interface{}{
				"checksum": "test-checksum",
				"content":  `{"task_id":"task-1","data_id":"callback-test","state":"done","full_pages":[]}`,
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "failed callback",
			body: map[string]interface{}{
				"checksum": "test-checksum",
				"content":  `{"task_id":"task-1","data_id":"callback-test","state":"failed","err_msg":"test error"}`,
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "non-existent contract",
			body: map[string]interface{}{
				"checksum": "test-checksum",
				"content":  `{"task_id":"task-1","data_id":"non-existent","state":"done"}`,
			},
			expectedStatus: http.StatusNotFound,
		},
		{
			name: "invalid content format",
			body: map[string]interface{}{
				"checksum": "test-checksum",
				"content":  "invalid json",
			},
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Reset contract status for each test
			store.UpdateStatus("callback-test", model.StatusProcessing, "")

			router := gin.New()
			router.POST("/callback", handler.HandleCallback)

			body, _ := json.Marshal(tt.body)
			req := httptest.NewRequest("POST", "/callback", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}

	// Cleanup
	store.Delete("callback-test")
}

func TestCallbackHandlerInvalidRequest(t *testing.T) {
	handler := NewCallbackHandler(nil)

	router := gin.New()
	router.POST("/callback", handler.HandleCallback)

	req := httptest.NewRequest("POST", "/callback", bytes.NewBufferString("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestCallbackHandlerFailedState(t *testing.T) {
	store := service.GetContractStore()

	contract := &model.Contract{
		ID:        "callback-failed-test",
		Tenant:    "tenant1",
		Status:    model.StatusProcessing,
		CreatedAt: time.Now(),
	}
	store.Save(contract)

	handler := NewCallbackHandler(nil)

	router := gin.New()
	router.POST("/callback", handler.HandleCallback)

	body, _ := json.Marshal(map[string]interface{}{
		"checksum": "test-checksum",
		"content":  `{"task_id":"task-1","data_id":"callback-failed-test","state":"failed","err_msg":"extraction failed"}`,
	})

	req := httptest.NewRequest("POST", "/callback", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Verify status was updated
	updated := store.Get("callback-failed-test")
	if updated.Status != model.StatusFailed {
		t.Errorf("Expected status '%s', got '%s'", model.StatusFailed, updated.Status)
	}
	if updated.ErrorMsg != "extraction failed" {
		t.Errorf("Expected error msg 'extraction failed', got '%s'", updated.ErrorMsg)
	}

	store.Delete("callback-failed-test")
}
