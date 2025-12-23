package middleware

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestLoggerMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Capture log output
	var buf bytes.Buffer
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	slog.SetDefault(slog.New(handler))

	router := gin.New()
	router.Use(RequestID())
	router.Use(RequestLogger())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "ok"})
	})
	router.GET("/error", func(c *gin.Context) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
	})
	router.GET("/server-error", func(c *gin.Context) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server error"})
	})

	tests := []struct {
		name           string
		path           string
		expectedStatus int
		logLevel       string
	}{
		{"success request", "/test", http.StatusOK, "INFO"},
		{"client error", "/error", http.StatusBadRequest, "WARN"},
		{"server error", "/server-error", http.StatusInternalServerError, "ERROR"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buf.Reset()

			req := httptest.NewRequest("GET", tt.path, nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			logOutput := buf.String()
			if !strings.Contains(logOutput, "request completed") {
				t.Error("Expected 'request completed' in log")
			}
			if !strings.Contains(logOutput, tt.path) {
				t.Errorf("Expected path '%s' in log", tt.path)
			}
			if !strings.Contains(logOutput, tt.logLevel) {
				t.Errorf("Expected log level '%s' in log", tt.logLevel)
			}
		})
	}
}

func TestRequestLoggerWithQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var buf bytes.Buffer
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	slog.SetDefault(slog.New(handler))

	router := gin.New()
	router.Use(RequestLogger())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "ok"})
	})

	req := httptest.NewRequest("GET", "/test?foo=bar&baz=qux", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	logOutput := buf.String()
	if !strings.Contains(logOutput, "query") {
		t.Error("Expected query parameters in log")
	}
}
