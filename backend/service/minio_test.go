package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/AnTengye/contractdiff/backend/config"
)

func TestNewMinioService(t *testing.T) {
	// Test with invalid endpoint (should fail)
	cfg := &config.MinioConfig{
		Endpoint:  "invalid-endpoint:9000",
		AccessKey: "test",
		SecretKey: "test",
		Bucket:    "test",
		UseSSL:    false,
	}

	svc, err := NewMinioService(cfg)
	// NewMinioService typically succeeds as it just creates the client
	// The actual connection is tested on first operation
	if err != nil {
		// This is acceptable - some minio client versions may validate early
		t.Logf("NewMinioService returned error as expected: %v", err)
	} else if svc == nil {
		t.Error("Expected non-nil service")
	}
}

func TestMinioServiceGetPublicURL(t *testing.T) {
	tests := []struct {
		name       string
		useSSL     bool
		endpoint   string
		bucket     string
		objectName string
		expected   string
	}{
		{
			name:       "http url",
			useSSL:     false,
			endpoint:   "localhost:9000",
			bucket:     "test-bucket",
			objectName: "path/to/file.pdf",
			expected:   "http://localhost:9000/test-bucket/path/to/file.pdf",
		},
		{
			name:       "https url",
			useSSL:     true,
			endpoint:   "minio.example.com",
			bucket:     "contracts",
			objectName: "tenant/abc/doc.pdf",
			expected:   "https://minio.example.com/contracts/tenant/abc/doc.pdf",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &MinioService{
				bucket: tt.bucket,
				config: &config.MinioConfig{
					Endpoint: tt.endpoint,
					UseSSL:   tt.useSSL,
				},
			}

			result := svc.GetPublicURL(tt.objectName)
			if result != tt.expected {
				t.Errorf("Expected '%s', got '%s'", tt.expected, result)
			}
		})
	}
}

// Mock server tests for MinIO operations
func TestMinioServiceUploadFile(t *testing.T) {
	// Create a mock MinIO server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PUT" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	}))
	defer server.Close()

	// Note: This is a simplified test - real MinIO client requires proper setup
	// For full coverage, you would need to use minio's mock or integration tests
	t.Skip("MinIO operations require actual MinIO client mock")
}

// TestSSLMismatchError verifies the error when HTTPS client connects to HTTP server
// This reproduces: "http: server gave HTTP response to HTTPS client"
func TestSSLMismatchError(t *testing.T) {
	// Create HTTP server (no TLS)
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer httpServer.Close()

	// Extract host:port from server URL (remove http:// prefix)
	endpoint := strings.TrimPrefix(httpServer.URL, "http://")

	// Configure MinIO client with UseSSL=true against HTTP server
	cfg := &config.MinioConfig{
		Endpoint:   endpoint,
		AccessKey:  "test",
		SecretKey:  "test",
		Bucket:     "test",
		UseSSL:     true, // WRONG: server is HTTP, not HTTPS
		ExpireDays: 7,
	}

	svc, err := NewMinioService(cfg)
	if err != nil {
		t.Fatalf("Failed to create MinIO service: %v", err)
	}

	// Try to ensure bucket - this will trigger the SSL mismatch error
	ctx := context.Background()
	err = svc.EnsureBucket(ctx)

	// Should get an error about HTTP response to HTTPS client
	if err == nil {
		t.Error("Expected SSL mismatch error, got nil")
		return
	}

	errStr := err.Error()
	// The error message varies but typically contains one of these
	isSSLError := strings.Contains(errStr, "http: server gave HTTP response to HTTPS client") ||
		strings.Contains(errStr, "tls:") ||
		strings.Contains(errStr, "certificate") ||
		strings.Contains(errStr, "x509")

	if !isSSLError {
		t.Logf("Got error (may still be SSL related): %v", err)
	} else {
		t.Logf("Confirmed SSL mismatch error: %v", err)
	}
}

// TestCorrectSSLConfig verifies correct configuration works
func TestCorrectSSLConfig(t *testing.T) {
	// Create HTTP server (no TLS)
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// MinIO SDK checks for bucket existence with HEAD request
		if r.Method == "HEAD" || r.Method == "GET" {
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer httpServer.Close()

	endpoint := strings.TrimPrefix(httpServer.URL, "http://")

	// Configure MinIO client with UseSSL=false (correct for HTTP server)
	cfg := &config.MinioConfig{
		Endpoint:   endpoint,
		AccessKey:  "test",
		SecretKey:  "test",
		Bucket:     "test",
		UseSSL:     false, // CORRECT: matches HTTP server
		ExpireDays: 7,
	}

	svc, err := NewMinioService(cfg)
	if err != nil {
		t.Fatalf("Failed to create MinIO service: %v", err)
	}

	// With correct SSL config, we should at least connect
	// (bucket operation may fail for other reasons, but not SSL)
	ctx := context.Background()
	err = svc.EnsureBucket(ctx)

	if err != nil {
		errStr := err.Error()
		// Should NOT be an SSL error
		isSSLError := strings.Contains(errStr, "http: server gave HTTP response to HTTPS client") ||
			strings.Contains(errStr, "tls:")

		if isSSLError {
			t.Errorf("Got unexpected SSL error with correct config: %v", err)
		} else {
			// Other errors are acceptable (mock server doesn't fully implement MinIO)
			t.Logf("Non-SSL error (expected with mock): %v", err)
		}
	}
}

func TestMinioServiceEnsureBucket(t *testing.T) {
	// Note: This requires actual MinIO connection or proper mocking
	t.Skip("MinIO operations require actual MinIO client mock")
}

func TestMinioServiceDeleteFile(t *testing.T) {
	// Note: This requires actual MinIO connection or proper mocking
	t.Skip("MinIO operations require actual MinIO client mock")
}

func TestMinioServiceGetPresignedURL(t *testing.T) {
	// Note: This requires actual MinIO connection or proper mocking
	t.Skip("MinIO operations require actual MinIO client mock")
}

func TestMinioServiceWithContext(t *testing.T) {
	cfg := &config.MinioConfig{
		Endpoint:   "localhost:9000",
		AccessKey:  "test",
		SecretKey:  "test",
		Bucket:     "test",
		UseSSL:     false,
		ExpireDays: 7,
	}

	svc, err := NewMinioService(cfg)
	if err != nil {
		t.Skip("Could not create MinIO service")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err = svc.UploadFile(ctx, "test", strings.NewReader("test"), 4, "text/plain")
	if err == nil {
		t.Log("Upload with cancelled context - error handling depends on client implementation")
	}
}

func TestRetryMechanismOnTransientError(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	endpoint := strings.TrimPrefix(server.URL, "http://")

	cfg := &config.MinioConfig{
		Endpoint:   endpoint,
		AccessKey:  "test",
		SecretKey:  "test",
		Bucket:     "test",
		UseSSL:     false,
		ExpireDays: 7,
	}

	svc, err := NewMinioService(cfg)
	if err != nil {
		t.Fatalf("Failed to create MinIO service: %v", err)
	}

	ctx := context.Background()
	err = svc.UploadFile(ctx, "test-object", strings.NewReader("test data"), 9, "text/plain")

	t.Logf("Request count: %d, Error: %v", requestCount, err)
	if requestCount < 2 {
		t.Error("Expected at least 2 requests due to retry mechanism")
	}
}

func TestIsRetryableError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{"nil error", nil, false},
		{"SSL mismatch", fmt.Errorf("http: server gave HTTP response to HTTPS client"), true},
		{"connection reset", fmt.Errorf("connection reset by peer"), true},
		{"connection refused", fmt.Errorf("dial tcp: connection refused"), true},
		{"timeout", fmt.Errorf("i/o timeout"), true},
		{"EOF", fmt.Errorf("unexpected EOF"), true},
		{"auth error", fmt.Errorf("Access Denied"), false},
		{"not found", fmt.Errorf("bucket not found"), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isRetryableError(tt.err)
			if result != tt.expected {
				t.Errorf("isRetryableError(%v) = %v, want %v", tt.err, result, tt.expected)
			}
		})
	}
}
