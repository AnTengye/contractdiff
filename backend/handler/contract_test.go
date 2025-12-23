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

func init() {
	gin.SetMode(gin.TestMode)
}

// Mock store for testing
func setupTestStore() *service.ContractStore {
	return service.GetContractStore()
}

func TestContractHandlerList(t *testing.T) {
	store := setupTestStore()

	// Add test contracts
	store.Save(&model.Contract{
		ID:        "test-1",
		Filename:  "test1.pdf",
		Tenant:    "tenant1",
		Status:    model.StatusCompleted,
		CreatedAt: time.Now(),
	})
	store.Save(&model.Contract{
		ID:        "test-2",
		Filename:  "test2.pdf",
		Tenant:    "tenant1",
		Status:    model.StatusPending,
		CreatedAt: time.Now(),
	})
	store.Save(&model.Contract{
		ID:        "test-3",
		Filename:  "test3.pdf",
		Tenant:    "tenant2",
		Status:    model.StatusCompleted,
		CreatedAt: time.Now(),
	})

	handler := &ContractHandler{store: store}

	router := gin.New()
	router.GET("/contracts", func(c *gin.Context) {
		c.Set("tenant", "tenant1")
		handler.List(c)
	})

	req := httptest.NewRequest("GET", "/contracts", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response map[string][]map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	contracts := response["contracts"]
	if len(contracts) != 2 {
		t.Errorf("Expected 2 contracts for tenant1, got %d", len(contracts))
	}

	// Cleanup
	store.Delete("test-1")
	store.Delete("test-2")
	store.Delete("test-3")
}

func TestContractHandlerGet(t *testing.T) {
	store := setupTestStore()

	contract := &model.Contract{
		ID:        "get-test",
		Filename:  "test.pdf",
		Tenant:    "tenant1",
		Status:    model.StatusCompleted,
		PDFURL:    "http://example.com/test.pdf",
		CreatedAt: time.Now(),
	}
	store.Save(contract)

	handler := &ContractHandler{store: store}

	tests := []struct {
		name           string
		id             string
		tenant         string
		expectedStatus int
	}{
		{
			name:           "valid get",
			id:             "get-test",
			tenant:         "tenant1",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "wrong tenant",
			id:             "get-test",
			tenant:         "tenant2",
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "non-existent",
			id:             "non-existent",
			tenant:         "tenant1",
			expectedStatus: http.StatusNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := gin.New()
			router.GET("/contracts/:id", func(c *gin.Context) {
				c.Set("tenant", tt.tenant)
				handler.Get(c)
			})

			req := httptest.NewRequest("GET", "/contracts/"+tt.id, nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}

	store.Delete("get-test")
}

func TestContractHandlerGetStatus(t *testing.T) {
	store := setupTestStore()

	contract := &model.Contract{
		ID:        "status-test",
		Tenant:    "tenant1",
		Status:    model.StatusProcessing,
		ErrorMsg:  "",
		CreatedAt: time.Now(),
	}
	store.Save(contract)

	handler := &ContractHandler{store: store}

	router := gin.New()
	router.GET("/contracts/:id/status", func(c *gin.Context) {
		c.Set("tenant", "tenant1")
		handler.GetStatus(c)
	})

	req := httptest.NewRequest("GET", "/contracts/status-test/status", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if response["status"] != model.StatusProcessing {
		t.Errorf("Expected status '%s', got '%v'", model.StatusProcessing, response["status"])
	}

	store.Delete("status-test")
}

func TestContractHandlerDelete(t *testing.T) {
	store := setupTestStore()

	contract := &model.Contract{
		ID:        "delete-test",
		Tenant:    "tenant1",
		CreatedAt: time.Now(),
	}
	store.Save(contract)

	handler := &ContractHandler{store: store}

	tests := []struct {
		name           string
		id             string
		tenant         string
		expectedStatus int
	}{
		{
			name:           "valid delete",
			id:             "delete-test",
			tenant:         "tenant1",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "already deleted",
			id:             "delete-test",
			tenant:         "tenant1",
			expectedStatus: http.StatusNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := gin.New()
			router.DELETE("/contracts/:id", func(c *gin.Context) {
				c.Set("tenant", tt.tenant)
				c.Set("request_id", "test-request-id")
				handler.Delete(c)
			})

			req := httptest.NewRequest("DELETE", "/contracts/"+tt.id, nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}
}

func TestGetMapKeys(t *testing.T) {
	m := map[string]interface{}{
		"key1": "value1",
		"key2": "value2",
		"key3": "value3",
	}

	keys := getMapKeys(m)
	if len(keys) != 3 {
		t.Errorf("Expected 3 keys, got %d", len(keys))
	}

	// Check all keys are present
	keySet := make(map[string]bool)
	for _, k := range keys {
		keySet[k] = true
	}

	for k := range m {
		if !keySet[k] {
			t.Errorf("Expected key '%s' in result", k)
		}
	}
}

func TestContractHandlerUploadNoFile(t *testing.T) {
	handler := &ContractHandler{store: setupTestStore()}

	router := gin.New()
	router.POST("/upload", func(c *gin.Context) {
		c.Set("tenant", "tenant1")
		handler.Upload(c)
	})

	req := httptest.NewRequest("POST", "/upload", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}

	var response map[string]string
	json.Unmarshal(w.Body.Bytes(), &response)
	if response["error"] != "No file provided" {
		t.Errorf("Expected 'No file provided' error, got '%s'", response["error"])
	}
}

func TestContractHandlerUploadInvalidType(t *testing.T) {
	handler := &ContractHandler{store: setupTestStore()}

	router := gin.New()
	router.POST("/upload", func(c *gin.Context) {
		c.Set("tenant", "tenant1")
		handler.Upload(c)
	})

	// Create a multipart request with invalid file type
	body := &bytes.Buffer{}
	body.WriteString("--boundary\r\n")
	body.WriteString("Content-Disposition: form-data; name=\"file\"; filename=\"test.txt\"\r\n")
	body.WriteString("Content-Type: text/plain\r\n\r\n")
	body.WriteString("test content")
	body.WriteString("\r\n--boundary--\r\n")

	req := httptest.NewRequest("POST", "/upload", body)
	req.Header.Set("Content-Type", "multipart/form-data; boundary=boundary")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestContractHandlerGetStatusNotFound(t *testing.T) {
	store := setupTestStore()
	handler := &ContractHandler{store: store}

	router := gin.New()
	router.GET("/contracts/:id/status", func(c *gin.Context) {
		c.Set("tenant", "tenant1")
		handler.GetStatus(c)
	})

	req := httptest.NewRequest("GET", "/contracts/non-existent/status", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d", w.Code)
	}
}

func TestContractHandlerGetStatusWrongTenant(t *testing.T) {
	store := setupTestStore()

	contract := &model.Contract{
		ID:        "status-tenant-test",
		Tenant:    "tenant1",
		Status:    model.StatusProcessing,
		CreatedAt: time.Now(),
	}
	store.Save(contract)
	defer store.Delete("status-tenant-test")

	handler := &ContractHandler{store: store}

	router := gin.New()
	router.GET("/contracts/:id/status", func(c *gin.Context) {
		c.Set("tenant", "tenant2") // Wrong tenant
		handler.GetStatus(c)
	})

	req := httptest.NewRequest("GET", "/contracts/status-tenant-test/status", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("Expected status 404 for wrong tenant, got %d", w.Code)
	}
}

func TestContractHandlerDeleteWrongTenant(t *testing.T) {
	store := setupTestStore()

	contract := &model.Contract{
		ID:        "delete-tenant-test",
		Tenant:    "tenant1",
		CreatedAt: time.Now(),
	}
	store.Save(contract)
	defer store.Delete("delete-tenant-test")

	handler := &ContractHandler{store: store}

	router := gin.New()
	router.DELETE("/contracts/:id", func(c *gin.Context) {
		c.Set("tenant", "tenant2") // Wrong tenant
		c.Set("request_id", "test-request-id")
		handler.Delete(c)
	})

	req := httptest.NewRequest("DELETE", "/contracts/delete-tenant-test", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("Expected status 404 for wrong tenant, got %d", w.Code)
	}
}

func TestContractHandlerListEmpty(t *testing.T) {
	store := setupTestStore()
	handler := &ContractHandler{store: store}

	router := gin.New()
	router.GET("/contracts", func(c *gin.Context) {
		c.Set("tenant", "empty-tenant")
		handler.List(c)
	})

	req := httptest.NewRequest("GET", "/contracts", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response map[string][]map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if len(response["contracts"]) != 0 {
		t.Errorf("Expected 0 contracts, got %d", len(response["contracts"]))
	}
}

func TestNewContractHandler(t *testing.T) {
	handler := NewContractHandler(nil, nil)
	if handler == nil {
		t.Fatal("Expected non-nil handler")
	}
	if handler.store == nil {
		t.Error("Expected store to be initialized")
	}
}

func TestGetMapKeysEmpty(t *testing.T) {
	m := map[string]interface{}{}
	keys := getMapKeys(m)
	if len(keys) != 0 {
		t.Errorf("Expected 0 keys, got %d", len(keys))
	}
}
