package notify

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AnTengye/contractdiff/backend/config"
)

func TestDingTalkNotifier_Name(t *testing.T) {
	n := NewDingTalkNotifier(&config.DingTalkConfig{})
	if n.Name() != "DingTalk" {
		t.Errorf("Expected name 'DingTalk', got '%s'", n.Name())
	}
}

func TestDingTalkNotifier_IsConfigured(t *testing.T) {
	tests := []struct {
		name       string
		webhookURL string
		expected   bool
	}{
		{"empty URL", "", false},
		{"with URL", "https://example.com/webhook", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n := NewDingTalkNotifier(&config.DingTalkConfig{WebhookURL: tt.webhookURL})
			if n.IsConfigured() != tt.expected {
				t.Errorf("IsConfigured() = %v, expected %v", n.IsConfigured(), tt.expected)
			}
		})
	}
}

func TestDingTalkNotifier_Send(t *testing.T) {
	// Create a test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.Method != "POST" {
			t.Errorf("Expected POST, got %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("Expected Content-Type application/json")
		}

		// Parse request body
		var msg dingTalkMessage
		if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
			t.Errorf("Failed to decode request body: %v", err)
		}

		if msg.MsgType != "markdown" {
			t.Errorf("Expected msgtype 'markdown', got '%s'", msg.MsgType)
		}

		// Return success
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(dingTalkResponse{ErrCode: 0, ErrMsg: "ok"})
	}))
	defer server.Close()

	n := NewDingTalkNotifier(&config.DingTalkConfig{WebhookURL: server.URL})
	err := n.Send("Test Title", "Test Content")
	if err != nil {
		t.Errorf("Send() error = %v", err)
	}
}

func TestDingTalkNotifier_SendWithSecret(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify signature parameters are present
		query := r.URL.Query()
		if query.Get("timestamp") == "" {
			t.Error("Expected timestamp in query")
		}
		if query.Get("sign") == "" {
			t.Error("Expected sign in query")
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(dingTalkResponse{ErrCode: 0, ErrMsg: "ok"})
	}))
	defer server.Close()

	n := NewDingTalkNotifier(&config.DingTalkConfig{
		WebhookURL: server.URL,
		Secret:     "test-secret",
	})
	err := n.Send("Test Title", "Test Content")
	if err != nil {
		t.Errorf("Send() error = %v", err)
	}
}

func TestDingTalkNotifier_SendError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(dingTalkResponse{ErrCode: 400001, ErrMsg: "invalid token"})
	}))
	defer server.Close()

	n := NewDingTalkNotifier(&config.DingTalkConfig{WebhookURL: server.URL})
	err := n.Send("Test Title", "Test Content")
	if err == nil {
		t.Error("Expected error, got nil")
	}
}

func TestDingTalkSignatureGeneration(t *testing.T) {
	secret := "test-secret"
	timestamp := int64(1609459200000) // 2021-01-01 00:00:00 UTC in milliseconds

	sign := GenerateDingTalkSignature(secret, timestamp)
	if sign == "" {
		t.Error("Expected non-empty signature")
	}

	// Verify signature is deterministic
	sign2 := GenerateDingTalkSignature(secret, timestamp)
	if sign != sign2 {
		t.Error("Signature should be deterministic")
	}

	// Different timestamp should produce different signature
	sign3 := GenerateDingTalkSignature(secret, timestamp+1)
	if sign == sign3 {
		t.Error("Different timestamp should produce different signature")
	}
}

func TestFeishuNotifier_Name(t *testing.T) {
	n := NewFeishuNotifier(&config.FeishuConfig{})
	if n.Name() != "Feishu" {
		t.Errorf("Expected name 'Feishu', got '%s'", n.Name())
	}
}

func TestFeishuNotifier_IsConfigured(t *testing.T) {
	tests := []struct {
		name       string
		webhookURL string
		expected   bool
	}{
		{"empty URL", "", false},
		{"with URL", "https://example.com/webhook", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n := NewFeishuNotifier(&config.FeishuConfig{WebhookURL: tt.webhookURL})
			if n.IsConfigured() != tt.expected {
				t.Errorf("IsConfigured() = %v, expected %v", n.IsConfigured(), tt.expected)
			}
		})
	}
}

func TestFeishuNotifier_Send(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("Expected POST, got %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("Expected Content-Type application/json")
		}

		var msg feishuMessage
		if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
			t.Errorf("Failed to decode request body: %v", err)
		}

		if msg.MsgType != "text" {
			t.Errorf("Expected msg_type 'text', got '%s'", msg.MsgType)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(feishuResponse{Code: 0, Msg: "ok"})
	}))
	defer server.Close()

	n := NewFeishuNotifier(&config.FeishuConfig{WebhookURL: server.URL})
	err := n.Send("Test Title", "Test Content")
	if err != nil {
		t.Errorf("Send() error = %v", err)
	}
}

func TestFeishuNotifier_SendWithSecret(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var msg feishuSignedMessage
		if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
			t.Errorf("Failed to decode request body: %v", err)
		}

		if msg.Timestamp == "" {
			t.Error("Expected timestamp in body")
		}
		if msg.Sign == "" {
			t.Error("Expected sign in body")
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(feishuResponse{Code: 0, Msg: "ok"})
	}))
	defer server.Close()

	n := NewFeishuNotifier(&config.FeishuConfig{
		WebhookURL: server.URL,
		Secret:     "test-secret",
	})
	err := n.Send("Test Title", "Test Content")
	if err != nil {
		t.Errorf("Send() error = %v", err)
	}
}

func TestFeishuNotifier_SendError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(feishuResponse{Code: 19024, Msg: "invalid token"})
	}))
	defer server.Close()

	n := NewFeishuNotifier(&config.FeishuConfig{WebhookURL: server.URL})
	err := n.Send("Test Title", "Test Content")
	if err == nil {
		t.Error("Expected error, got nil")
	}
}

func TestFeishuSignatureGeneration(t *testing.T) {
	secret := "test-secret"
	timestamp := int64(1609459200) // 2021-01-01 00:00:00 UTC in seconds

	sign := GenerateFeishuSignature(secret, timestamp)
	if sign == "" {
		t.Error("Expected non-empty signature")
	}

	// Verify signature is deterministic
	sign2 := GenerateFeishuSignature(secret, timestamp)
	if sign != sign2 {
		t.Error("Signature should be deterministic")
	}

	// Different timestamp should produce different signature
	sign3 := GenerateFeishuSignature(secret, timestamp+1)
	if sign == sign3 {
		t.Error("Different timestamp should produce different signature")
	}
}

func TestManager_NewManager(t *testing.T) {
	tests := []struct {
		name          string
		cfg           *config.NotificationConfig
		expectedCount int
	}{
		{
			name:          "no notifiers",
			cfg:           &config.NotificationConfig{},
			expectedCount: 0,
		},
		{
			name: "only DingTalk",
			cfg: &config.NotificationConfig{
				DingTalk: config.DingTalkConfig{WebhookURL: "https://example.com"},
			},
			expectedCount: 1,
		},
		{
			name: "only Feishu",
			cfg: &config.NotificationConfig{
				Feishu: config.FeishuConfig{WebhookURL: "https://example.com"},
			},
			expectedCount: 1,
		},
		{
			name: "both notifiers",
			cfg: &config.NotificationConfig{
				DingTalk: config.DingTalkConfig{WebhookURL: "https://example.com"},
				Feishu:   config.FeishuConfig{WebhookURL: "https://example.com"},
			},
			expectedCount: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := NewManager(tt.cfg)
			if len(m.notifiers) != tt.expectedCount {
				t.Errorf("Expected %d notifiers, got %d", tt.expectedCount, len(m.notifiers))
			}
		})
	}
}

func TestManager_HasNotifiers(t *testing.T) {
	m1 := NewManager(&config.NotificationConfig{})
	if m1.HasNotifiers() {
		t.Error("Expected HasNotifiers() = false for empty config")
	}

	m2 := NewManager(&config.NotificationConfig{
		DingTalk: config.DingTalkConfig{WebhookURL: "https://example.com"},
	})
	if !m2.HasNotifiers() {
		t.Error("Expected HasNotifiers() = true when DingTalk is configured")
	}
}

func TestManager_SendToAll(t *testing.T) {
	// Test with no notifiers
	m := NewManager(&config.NotificationConfig{})
	err := m.SendToAll("Test", "Content")
	if err != nil {
		t.Errorf("SendToAll() should not error with no notifiers: %v", err)
	}

	// Test with working notifiers
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(dingTalkResponse{ErrCode: 0, ErrMsg: "ok"})
	}))
	defer server.Close()

	m2 := NewManager(&config.NotificationConfig{
		DingTalk: config.DingTalkConfig{WebhookURL: server.URL},
	})
	err = m2.SendToAll("Test", "Content")
	if err != nil {
		t.Errorf("SendToAll() error = %v", err)
	}
}
