package parser

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
)

func TestMineruParserGetTaskStatusIncludesRawData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"code": 0,
			"msg": "ok",
			"trace_id": "mineru-trace-1",
			"data": {
				"task_id": "task-123",
				"data_id": "doc-456",
				"state": "failed",
				"err_msg": "Token expired",
				"model_version": "vlm",
				"extract_progress": {
					"extracted_pages": 2,
					"total_pages": 5,
					"start_time": "2026-05-09T08:28:03Z"
				}
			}
		}`))
	}))
	defer server.Close()

	p, err := NewMineruParser(&config.MineruConfig{
		Enabled:      true,
		APIURL:       server.URL,
		APIToken:     "test-token",
		ModelVersion: "vlm",
	})
	if err != nil {
		t.Fatalf("NewMineruParser() error = %v", err)
	}

	status, err := p.GetTaskStatus(context.Background(), "task-123")
	if err != nil {
		t.Fatalf("GetTaskStatus() error = %v", err)
	}

	if status.State != "failed" {
		t.Fatalf("expected failed state, got %q", status.State)
	}
	if status.ErrorMessage != "解析工具 Token 已过期，请更新 Token" {
		t.Fatalf("expected friendly error message, got %q", status.ErrorMessage)
	}
	if status.Progress == nil {
		t.Fatal("expected progress to be populated")
	}
	if status.Progress.ProcessedPages != 2 || status.Progress.TotalPages != 5 {
		t.Fatalf("unexpected progress: %+v", status.Progress)
	}
	expectedStart := time.Date(2026, 5, 9, 8, 28, 3, 0, time.UTC)
	if !status.Progress.StartTime.Equal(expectedStart) {
		t.Fatalf("expected parsed start time %v, got %v", expectedStart, status.Progress.StartTime)
	}

	if status.RawData["trace_id"] != "mineru-trace-1" {
		t.Fatalf("expected trace_id in raw data, got %#v", status.RawData["trace_id"])
	}
	if status.RawData["task_id"] != "task-123" {
		t.Fatalf("expected task_id in raw data, got %#v", status.RawData["task_id"])
	}
	if status.RawData["data_id"] != "doc-456" {
		t.Fatalf("expected data_id in raw data, got %#v", status.RawData["data_id"])
	}
	if status.RawData["model_version"] != "vlm" {
		t.Fatalf("expected model_version in raw data, got %#v", status.RawData["model_version"])
	}
	if status.RawData["api_message"] != "ok" {
		t.Fatalf("expected api_message in raw data, got %#v", status.RawData["api_message"])
	}

	extractProgress, ok := status.RawData["extract_progress"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected extract_progress map, got %#v", status.RawData["extract_progress"])
	}
	if extractProgress["extracted_pages"] != 2 {
		t.Fatalf("expected extracted_pages 2, got %#v", extractProgress["extracted_pages"])
	}
	if extractProgress["total_pages"] != 5 {
		t.Fatalf("expected total_pages 5, got %#v", extractProgress["total_pages"])
	}
	if extractProgress["start_time"] != "2026-05-09T08:28:03Z" {
		t.Fatalf("expected start_time to be preserved, got %#v", extractProgress["start_time"])
	}
}
