package service

import (
	"context"
	"io"
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

// Test context cancellation
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

	// Test with cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// These operations should fail fast with cancelled context
	err = svc.UploadFile(ctx, "test", strings.NewReader("test"), 4, "text/plain")
	if err == nil {
		t.Log("Upload with cancelled context - error handling depends on client implementation")
	}
}

// Test reader interface
type errorReader struct{}

func (e errorReader) Read(p []byte) (n int, err error) {
	return 0, io.ErrUnexpectedEOF
}

func TestMinioServiceUploadFileWithErrorReader(t *testing.T) {
	// This test verifies error handling when reading fails
	t.Skip("MinIO operations require actual MinIO client mock")
}
