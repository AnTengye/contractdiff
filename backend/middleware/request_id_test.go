package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestIDMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(RequestID())
	router.GET("/test", func(c *gin.Context) {
		requestID := GetRequestID(c)
		c.JSON(http.StatusOK, gin.H{"request_id": requestID})
	})

	// Test auto-generated request ID
	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Check response header
	responseID := w.Header().Get("X-Request-ID")
	if responseID == "" {
		t.Error("Expected X-Request-ID header to be set")
	}
}

func TestRequestIDMiddlewareWithExistingID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(RequestID())
	router.GET("/test", func(c *gin.Context) {
		requestID := GetRequestID(c)
		c.JSON(http.StatusOK, gin.H{"request_id": requestID})
	})

	// Test with existing request ID
	existingID := "existing-request-id-123"
	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Request-ID", existingID)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	responseID := w.Header().Get("X-Request-ID")
	if responseID != existingID {
		t.Errorf("Expected request ID '%s', got '%s'", existingID, responseID)
	}
}

func TestGetRequestIDEmpty(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	// Test with no request ID set
	requestID := GetRequestID(c)
	if requestID != "" {
		t.Errorf("Expected empty string, got '%s'", requestID)
	}
}
