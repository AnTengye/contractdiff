package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestGenerateToken(t *testing.T) {
	cfg := &config.AuthConfig{
		JWTSecret:        "test-secret-key",
		TokenExpireHours: 24,
	}

	token, expiresAt, err := GenerateToken("testuser", "testtenant", cfg)
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	if token == "" {
		t.Error("Expected non-empty token")
	}

	// Verify expiration time is approximately 24 hours from now
	expectedExpiry := time.Now().Add(24 * time.Hour)
	if expiresAt.Before(expectedExpiry.Add(-time.Minute)) || expiresAt.After(expectedExpiry.Add(time.Minute)) {
		t.Errorf("Expiry time %v is not within expected range of %v", expiresAt, expectedExpiry)
	}
}

func TestAuthMiddleware(t *testing.T) {
	cfg := &config.AuthConfig{
		JWTSecret:        "test-secret-key",
		TokenExpireHours: 24,
	}

	// Generate a valid token
	token, _, err := GenerateToken("testuser", "testtenant", cfg)
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	tests := []struct {
		name           string
		authHeader     string
		expectedStatus int
	}{
		{
			name:           "valid token",
			authHeader:     "Bearer " + token,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "missing header",
			authHeader:     "",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "invalid format",
			authHeader:     token, // Missing "Bearer "
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "invalid token",
			authHeader:     "Bearer invalid.token.here",
			expectedStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := gin.New()
			router.Use(AuthMiddleware(cfg))
			router.GET("/test", func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{"message": "ok"})
			})

			req := httptest.NewRequest("GET", "/test", nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}
}

func TestAuthMiddlewareExpiredToken(t *testing.T) {
	cfg := &config.AuthConfig{
		JWTSecret:        "test-secret-key",
		TokenExpireHours: 24,
	}

	// Create an expired token
	claims := Claims{
		Username: "testuser",
		Tenant:   "testtenant",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Hour)), // Expired 1 hour ago
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString([]byte(cfg.JWTSecret))

	router := gin.New()
	router.Use(AuthMiddleware(cfg))
	router.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "ok"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status %d for expired token, got %d", http.StatusUnauthorized, w.Code)
	}
}

func TestGetUsername(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	// Test with no username set
	if GetUsername(c) != "" {
		t.Error("Expected empty string for unset username")
	}

	// Test with username set
	c.Set("username", "testuser")
	if GetUsername(c) != "testuser" {
		t.Errorf("Expected 'testuser', got '%s'", GetUsername(c))
	}
}

func TestGetTenant(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	// Test with no tenant set
	if GetTenant(c) != "" {
		t.Error("Expected empty string for unset tenant")
	}

	// Test with tenant set
	c.Set("tenant", "testtenant")
	if GetTenant(c) != "testtenant" {
		t.Errorf("Expected 'testtenant', got '%s'", GetTenant(c))
	}
}
