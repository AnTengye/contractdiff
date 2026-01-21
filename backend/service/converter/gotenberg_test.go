package converter

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
)

func TestNewGotenbergConverter(t *testing.T) {
	tests := []struct {
		name    string
		cfg     *config.GotenbergConfig
		wantErr bool
	}{
		{
			name:    "nil config",
			cfg:     nil,
			wantErr: true,
		},
		{
			name: "disabled config",
			cfg: &config.GotenbergConfig{
				Enabled: false,
				APIURL:  "http://localhost:3000",
			},
			wantErr: true,
		},
		{
			name: "valid config",
			cfg: &config.GotenbergConfig{
				Enabled: true,
				APIURL:  "http://localhost:3000",
				Timeout: 60,
			},
			wantErr: false,
		},
		{
			name: "valid config with zero timeout uses default",
			cfg: &config.GotenbergConfig{
				Enabled: true,
				APIURL:  "http://localhost:3000",
				Timeout: 0,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			converter, err := NewGotenbergConverter(tt.cfg)
			if (err != nil) != tt.wantErr {
				t.Errorf("NewGotenbergConverter() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && converter == nil {
				t.Error("Expected non-nil converter")
			}
		})
	}
}

func TestConvertDOCXToPDF_Success(t *testing.T) {
	// Mock Gotenberg server returning PDF
	mockPDF := []byte("%PDF-1.4 mock pdf content")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.Method != "POST" {
			t.Errorf("Expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/forms/libreoffice/convert" {
			t.Errorf("Expected /forms/libreoffice/convert, got %s", r.URL.Path)
		}
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			t.Errorf("Expected multipart/form-data content type, got %s", r.Header.Get("Content-Type"))
		}

		// Parse multipart form to verify file upload
		err := r.ParseMultipartForm(10 << 20) // 10MB
		if err != nil {
			t.Errorf("Failed to parse multipart form: %v", err)
		}

		file, header, err := r.FormFile("files")
		if err != nil {
			t.Errorf("Failed to get form file: %v", err)
		}
		defer file.Close()

		if header.Filename != "test.docx" {
			t.Errorf("Expected filename 'test.docx', got '%s'", header.Filename)
		}

		// Return mock PDF
		w.Header().Set("Content-Type", "application/pdf")
		w.WriteHeader(http.StatusOK)
		w.Write(mockPDF)
	}))
	defer server.Close()

	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  server.URL,
		Timeout: 60,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	docxContent := []byte("mock docx content")
	pdfContent, err := converter.ConvertDOCXToPDF(context.Background(), docxContent, "test.docx")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if string(pdfContent) != string(mockPDF) {
		t.Errorf("Expected PDF content '%s', got '%s'", string(mockPDF), string(pdfContent))
	}
}

func TestConvertDOCXToPDF_502Error(t *testing.T) {
	// Mock Gotenberg server returning 502 Bad Gateway
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte(""))
	}))
	defer server.Close()

	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  server.URL,
		Timeout: 60,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	_, err = converter.ConvertDOCXToPDF(context.Background(), []byte("content"), "test.docx")

	if err == nil {
		t.Fatal("Expected error for 502 response")
	}
	if !strings.Contains(err.Error(), "502") {
		t.Errorf("Expected error to contain '502', got: %v", err)
	}
}

func TestConvertDOCXToPDF_502WithMessage(t *testing.T) {
	// Mock Gotenberg server returning 502 with error message
	errorBody := "upstream connect error or disconnect/reset before headers"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte(errorBody))
	}))
	defer server.Close()

	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  server.URL,
		Timeout: 60,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	_, err = converter.ConvertDOCXToPDF(context.Background(), []byte("content"), "test.docx")

	if err == nil {
		t.Fatal("Expected error for 502 response")
	}
	if !strings.Contains(err.Error(), "502") {
		t.Errorf("Expected error to contain '502', got: %v", err)
	}
	if !strings.Contains(err.Error(), errorBody) {
		t.Errorf("Expected error to contain error body, got: %v", err)
	}
}

func TestConvertDOCXToPDF_500Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("LibreOffice conversion failed"))
	}))
	defer server.Close()

	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  server.URL,
		Timeout: 60,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	_, err = converter.ConvertDOCXToPDF(context.Background(), []byte("content"), "test.docx")

	if err == nil {
		t.Fatal("Expected error for 500 response")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("Expected error to contain '500', got: %v", err)
	}
}

func TestConvertDOCXToPDF_NetworkError(t *testing.T) {
	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  "http://localhost:59999", // Non-existent port
		Timeout: 1,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	_, err = converter.ConvertDOCXToPDF(context.Background(), []byte("content"), "test.docx")

	if err == nil {
		t.Fatal("Expected error for network failure")
	}
}

func TestConvertDOCXToPDF_Timeout(t *testing.T) {
	// Server that takes too long to respond
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(3 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  server.URL,
		Timeout: 1, // 1 second timeout
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	_, err = converter.ConvertDOCXToPDF(ctx, []byte("content"), "test.docx")

	if err == nil {
		t.Fatal("Expected timeout error")
	}
}

func TestConvertDOCXFromURL_Success(t *testing.T) {
	mockPDF := []byte("%PDF-1.4 mock pdf content")
	mockDOCX := []byte("mock docx content")

	// Mock DOCX download server
	docxServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
		w.WriteHeader(http.StatusOK)
		w.Write(mockDOCX)
	}))
	defer docxServer.Close()

	// Mock Gotenberg server
	gotenbergServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		w.WriteHeader(http.StatusOK)
		w.Write(mockPDF)
	}))
	defer gotenbergServer.Close()

	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  gotenbergServer.URL,
		Timeout: 60,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	pdfContent, err := converter.ConvertDOCXFromURL(context.Background(), docxServer.URL)

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if string(pdfContent) != string(mockPDF) {
		t.Errorf("Expected PDF content '%s', got '%s'", string(mockPDF), string(pdfContent))
	}
}

func TestConvertDOCXFromURL_DownloadFailed(t *testing.T) {
	// Mock server returning 404 for DOCX download
	docxServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer docxServer.Close()

	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  "http://gotenberg:3000",
		Timeout: 60,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	_, err = converter.ConvertDOCXFromURL(context.Background(), docxServer.URL)

	if err == nil {
		t.Fatal("Expected error for failed download")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("Expected error to contain '404', got: %v", err)
	}
}

func TestIsAvailable_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Errorf("Expected /health, got %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  server.URL,
		Timeout: 60,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	if !converter.IsAvailable(context.Background()) {
		t.Error("Expected IsAvailable to return true")
	}
}

func TestIsAvailable_ServiceDown(t *testing.T) {
	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  "http://localhost:59999",
		Timeout: 1,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	if converter.IsAvailable(context.Background()) {
		t.Error("Expected IsAvailable to return false for unavailable service")
	}
}

func TestIsAvailable_HealthCheckFailed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  server.URL,
		Timeout: 60,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	if converter.IsAvailable(context.Background()) {
		t.Error("Expected IsAvailable to return false for unhealthy service")
	}
}

// TestConvertDOCXToPDF_WithRealFile tests conversion with an actual DOCX file
// This is an integration test that requires a running Gotenberg server
// Skip if GOTENBERG_URL environment variable is not set
func TestConvertDOCXToPDF_WithRealFile(t *testing.T) {
	gotenbergURL := os.Getenv("GOTENBERG_URL")
	if gotenbergURL == "" {
		t.Skip("GOTENBERG_URL not set, skipping integration test")
	}

	// Find test.docx file
	testDocxPath := filepath.Join("..", "..", "..", "test.docx")
	docxContent, err := os.ReadFile(testDocxPath)
	if err != nil {
		t.Skipf("test.docx not found at %s: %v", testDocxPath, err)
	}

	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  gotenbergURL,
		Timeout: 120,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	// First check if service is available
	if !converter.IsAvailable(context.Background()) {
		t.Skip("Gotenberg service not available")
	}

	pdfContent, err := converter.ConvertDOCXToPDF(context.Background(), docxContent, "test.docx")

	if err != nil {
		t.Fatalf("Conversion failed: %v", err)
	}

	// Verify PDF header
	if len(pdfContent) < 4 || string(pdfContent[:4]) != "%PDF" {
		t.Errorf("Expected PDF content, got: %s", string(pdfContent[:min(20, len(pdfContent))]))
	}

	t.Logf("Successfully converted DOCX to PDF, size: %d bytes", len(pdfContent))
}

// TestAnalyze502Error helps diagnose 502 error causes
func TestAnalyze502Error(t *testing.T) {
	t.Log("=== 502 Error Analysis ===")
	t.Log("Common causes of Gotenberg 502 errors:")
	t.Log("")
	t.Log("1. Gotenberg service not running:")
	t.Log("   - Check: docker ps | grep gotenberg")
	t.Log("   - Fix: docker-compose up -d gotenberg")
	t.Log("")
	t.Log("2. LibreOffice not installed or crashed in container:")
	t.Log("   - Check: docker logs <gotenberg-container>")
	t.Log("   - Fix: Use official gotenberg/gotenberg image")
	t.Log("")
	t.Log("3. Timeout during conversion (large/complex documents):")
	t.Log("   - Increase timeout in config.yaml")
	t.Log("   - Check document complexity")
	t.Log("")
	t.Log("4. Memory issues:")
	t.Log("   - Check: docker stats <gotenberg-container>")
	t.Log("   - Fix: Increase container memory limit")
	t.Log("")
	t.Log("5. Network issues between containers:")
	t.Log("   - Check: docker network ls")
	t.Log("   - Ensure both containers are on same network")
	t.Log("")
	t.Log("6. Incorrect API URL:")
	t.Log("   - Verify gotenberg.api_url in config.yaml")
	t.Log("   - Should be: http://gotenberg:3000 (docker) or http://localhost:3000 (local)")
	t.Log("")
	t.Log("7. DOCX file corruption or unsupported features:")
	t.Log("   - Try with a simple DOCX file first")
	t.Log("   - Check if file opens correctly in LibreOffice")
}

// Diagnostic test to verify Gotenberg connectivity
func TestGotenbergConnectivity(t *testing.T) {
	gotenbergURL := os.Getenv("GOTENBERG_URL")
	if gotenbergURL == "" {
		gotenbergURL = "http://localhost:3000"
		t.Logf("GOTENBERG_URL not set, using default: %s", gotenbergURL)
	}

	cfg := &config.GotenbergConfig{
		Enabled: true,
		APIURL:  gotenbergURL,
		Timeout: 10,
	}

	converter, err := NewGotenbergConverter(cfg)
	if err != nil {
		t.Fatalf("Failed to create converter: %v", err)
	}

	// Test health endpoint
	resp, err := http.Get(gotenbergURL + "/health")
	if err != nil {
		t.Logf("Health check failed: %v", err)
		t.Log("Gotenberg service appears to be down or unreachable")
		t.Log("Start with: docker run -d -p 3000:3000 gotenberg/gotenberg:8")
		t.Skip("Gotenberg not available")
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	t.Logf("Health check response: status=%d, body=%s", resp.StatusCode, string(body))

	if converter.IsAvailable(context.Background()) {
		t.Log("Gotenberg service is available and healthy")
	} else {
		t.Log("Gotenberg service returned unhealthy status")
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
