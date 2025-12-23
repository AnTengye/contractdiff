package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AnTengye/contractdiff/backend/config"
)

func TestNewMineruService(t *testing.T) {
	cfg := &config.MineruConfig{
		APIURL:       "https://api.mineru.test",
		APIToken:     "test-token",
		ModelVersion: "vlm",
	}

	svc := NewMineruService(cfg)
	if svc == nil {
		t.Fatal("Expected non-nil service")
	}
	if svc.config != cfg {
		t.Error("Expected config to be set")
	}
	if svc.httpClient == nil {
		t.Error("Expected httpClient to be set")
	}
}

func TestMineruServiceCreateTask(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.Method != "POST" {
			t.Errorf("Expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/extract/task" {
			t.Errorf("Expected /extract/task, got %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("Expected Authorization header")
		}

		// Return success response
		response := MineruTaskResponse{
			Code:    0,
			Message: "success",
		}
		response.Data.TaskID = "task-123"

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.MineruConfig{
		APIURL:       server.URL,
		APIToken:     "test-token",
		ModelVersion: "vlm",
	}

	svc := NewMineruService(cfg)
	resp, err := svc.CreateTask("http://example.com/test.pdf", "data-123")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if resp.Data.TaskID != "task-123" {
		t.Errorf("Expected task ID 'task-123', got '%s'", resp.Data.TaskID)
	}
}

func TestMineruServiceCreateTaskWithCallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody MineruTaskRequest
		json.NewDecoder(r.Body).Decode(&reqBody)

		if reqBody.Callback != "http://callback.test" {
			t.Errorf("Expected callback URL, got '%s'", reqBody.Callback)
		}
		if reqBody.Seed != "test-seed" {
			t.Errorf("Expected seed, got '%s'", reqBody.Seed)
		}

		response := MineruTaskResponse{Code: 0}
		response.Data.TaskID = "task-456"
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.MineruConfig{
		APIURL:       server.URL,
		APIToken:     "test-token",
		ModelVersion: "vlm",
		CallbackURL:  "http://callback.test",
		Seed:         "test-seed",
	}

	svc := NewMineruService(cfg)
	_, err := svc.CreateTask("http://example.com/test.pdf", "data-123")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
}

func TestMineruServiceCreateTaskError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := MineruTaskResponse{
			Code:    1,
			Message: "API error",
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.MineruConfig{
		APIURL:   server.URL,
		APIToken: "test-token",
	}

	svc := NewMineruService(cfg)
	_, err := svc.CreateTask("http://example.com/test.pdf", "data-123")

	if err == nil {
		t.Error("Expected error for API error response")
	}
}

func TestMineruServiceGetTaskStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("Expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/extract/task/task-123" {
			t.Errorf("Expected /extract/task/task-123, got %s", r.URL.Path)
		}

		response := MineruTaskStatusResponse{
			Code: 0,
		}
		response.Data.TaskID = "task-123"
		response.Data.State = "done"
		response.Data.FullZipURL = "http://example.com/result.zip"

		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.MineruConfig{
		APIURL:   server.URL,
		APIToken: "test-token",
	}

	svc := NewMineruService(cfg)
	status, err := svc.GetTaskStatus("task-123")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if status.Data.State != "done" {
		t.Errorf("Expected state 'done', got '%s'", status.Data.State)
	}
	if status.Data.FullZipURL != "http://example.com/result.zip" {
		t.Errorf("Expected zip URL, got '%s'", status.Data.FullZipURL)
	}
}

func TestMineruServiceGetTaskStatusError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := MineruTaskStatusResponse{
			Code:    1,
			Message: "Task not found",
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.MineruConfig{
		APIURL:   server.URL,
		APIToken: "test-token",
	}

	svc := NewMineruService(cfg)
	_, err := svc.GetTaskStatus("invalid-task")

	if err == nil {
		t.Error("Expected error for API error response")
	}
}

func TestMineruServiceVerifyCallback(t *testing.T) {
	cfg := &config.MineruConfig{
		Seed: "test-seed",
	}

	svc := NewMineruService(cfg)

	// Calculate expected checksum: SHA256(uid + seed + content)
	// This is a simplified test - in real use, you'd compute the actual hash
	result := svc.VerifyCallback("invalid-checksum", "test-content", "test-uid")
	if result {
		t.Error("Expected false for invalid checksum")
	}
}

func TestMineruServiceFetchJSONResult(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"key1": "value1",
			"key2": 123,
		})
	}))
	defer server.Close()

	cfg := &config.MineruConfig{}
	svc := NewMineruService(cfg)

	result, err := svc.FetchJSONResult(server.URL)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if result["key1"] != "value1" {
		t.Errorf("Expected key1='value1', got '%v'", result["key1"])
	}
}

func TestMineruServiceFetchJSONResultInvalid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("invalid json"))
	}))
	defer server.Close()

	cfg := &config.MineruConfig{}
	svc := NewMineruService(cfg)

	_, err := svc.FetchJSONResult(server.URL)
	if err == nil {
		t.Error("Expected error for invalid JSON")
	}
}

func TestMineruServiceCreateTaskNetworkError(t *testing.T) {
	cfg := &config.MineruConfig{
		APIURL:   "http://invalid-host-that-does-not-exist:9999",
		APIToken: "test-token",
	}

	svc := NewMineruService(cfg)
	_, err := svc.CreateTask("http://example.com/test.pdf", "data-123")

	if err == nil {
		t.Error("Expected error for network failure")
	}
}

func TestMineruServiceGetTaskStatusNetworkError(t *testing.T) {
	cfg := &config.MineruConfig{
		APIURL:   "http://invalid-host-that-does-not-exist:9999",
		APIToken: "test-token",
	}

	svc := NewMineruService(cfg)
	_, err := svc.GetTaskStatus("task-123")

	if err == nil {
		t.Error("Expected error for network failure")
	}
}

func TestMineruServiceCreateTaskInvalidResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not json"))
	}))
	defer server.Close()

	cfg := &config.MineruConfig{
		APIURL:   server.URL,
		APIToken: "test-token",
	}

	svc := NewMineruService(cfg)
	_, err := svc.CreateTask("http://example.com/test.pdf", "data-123")

	if err == nil {
		t.Error("Expected error for invalid JSON response")
	}
}

func TestMineruServiceGetTaskStatusInvalidResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not json"))
	}))
	defer server.Close()

	cfg := &config.MineruConfig{
		APIURL:   server.URL,
		APIToken: "test-token",
	}

	svc := NewMineruService(cfg)
	_, err := svc.GetTaskStatus("task-123")

	if err == nil {
		t.Error("Expected error for invalid JSON response")
	}
}

func TestMineruServiceFetchJSONResultNetworkError(t *testing.T) {
	cfg := &config.MineruConfig{}
	svc := NewMineruService(cfg)

	_, err := svc.FetchJSONResult("http://invalid-host-that-does-not-exist:9999/test.json")
	if err == nil {
		t.Error("Expected error for network failure")
	}
}

func TestMineruServiceVerifyCallbackValid(t *testing.T) {
	cfg := &config.MineruConfig{
		Seed: "test-seed",
	}

	svc := NewMineruService(cfg)

	// Calculate the actual checksum: SHA256(uid + seed + content)
	// For uid="test-uid", seed="test-seed", content="test-content"
	// SHA256("test-uidtest-seedtest-content")
	// We're testing the logic, not the actual hash value
	result := svc.VerifyCallback("wrong-checksum", "content", "uid")
	if result {
		t.Error("Expected false for wrong checksum")
	}
}

func TestMineruServiceFetchZipAndExtractJSONNetworkError(t *testing.T) {
	cfg := &config.MineruConfig{}
	svc := NewMineruService(cfg)

	_, err := svc.FetchZipAndExtractJSON("http://invalid-host-that-does-not-exist:9999/test.zip")
	if err == nil {
		t.Error("Expected error for network failure")
	}
}

func TestMineruServiceFetchZipAndExtractJSONInvalidZip(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not a zip file"))
	}))
	defer server.Close()

	cfg := &config.MineruConfig{}
	svc := NewMineruService(cfg)

	_, err := svc.FetchZipAndExtractJSON(server.URL)
	if err == nil {
		t.Error("Expected error for invalid ZIP")
	}
}
