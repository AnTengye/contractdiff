package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestAuthHandlerLogin(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:        "test-secret",
			TokenExpireHours: 24,
		},
		Users: []config.User{
			{Username: "testuser", Password: "testpass", Tenant: "testtenant"},
		},
	}

	handler := NewAuthHandler(cfg)

	tests := []struct {
		name           string
		body           map[string]string
		expectedStatus int
	}{
		{
			name:           "valid login",
			body:           map[string]string{"username": "testuser", "password": "testpass"},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "invalid username",
			body:           map[string]string{"username": "wronguser", "password": "testpass"},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "invalid password",
			body:           map[string]string{"username": "testuser", "password": "wrongpass"},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "missing fields",
			body:           map[string]string{"username": "testuser"},
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := gin.New()
			router.POST("/login", handler.Login)

			body, _ := json.Marshal(tt.body)
			req := httptest.NewRequest("POST", "/login", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			if tt.expectedStatus == http.StatusOK {
				var response LoginResponse
				if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
					t.Errorf("Failed to parse response: %v", err)
				}
				if response.Token == "" {
					t.Error("Expected token in response")
				}
				if response.Username != "testuser" {
					t.Errorf("Expected username 'testuser', got '%s'", response.Username)
				}
				if response.Tenant != "testtenant" {
					t.Errorf("Expected tenant 'testtenant', got '%s'", response.Tenant)
				}
			}
		})
	}
}

func TestAuthHandlerGetCurrentUser(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:        "test-secret",
			TokenExpireHours: 24,
		},
	}

	handler := NewAuthHandler(cfg)

	router := gin.New()
	router.GET("/me", func(c *gin.Context) {
		c.Set("username", "testuser")
		c.Set("tenant", "testtenant")
		handler.GetCurrentUser(c)
	})

	req := httptest.NewRequest("GET", "/me", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Errorf("Failed to parse response: %v", err)
	}

	if response["username"] != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", response["username"])
	}
	if response["tenant"] != "testtenant" {
		t.Errorf("Expected tenant 'testtenant', got '%s'", response["tenant"])
	}
}

func TestAuthHandlerLoginInvalidJSON(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:        "test-secret",
			TokenExpireHours: 24,
		},
	}

	handler := NewAuthHandler(cfg)

	router := gin.New()
	router.POST("/login", handler.Login)

	req := httptest.NewRequest("POST", "/login", bytes.NewBufferString("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}
