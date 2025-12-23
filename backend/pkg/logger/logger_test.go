package logger

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

func TestInit(t *testing.T) {
	tests := []struct {
		name   string
		config *Config
	}{
		{"debug level text", &Config{Level: "debug", Format: "text"}},
		{"info level json", &Config{Level: "info", Format: "json"}},
		{"warn level text", &Config{Level: "warn", Format: "text"}},
		{"error level json", &Config{Level: "error", Format: "json"}},
		{"default level", &Config{Level: "invalid", Format: "text"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			Init(tt.config)
			// Just verify it doesn't panic
			slog.Info("test message")
		})
	}
}

func TestWithContext(t *testing.T) {
	// Initialize logger
	Init(&Config{Level: "debug", Format: "text"})

	// Create context with values
	ctx := context.Background()
	ctx = context.WithValue(ctx, RequestIDKey, "test-request-id")
	ctx = context.WithValue(ctx, TenantKey, "test-tenant")
	ctx = context.WithValue(ctx, UsernameKey, "test-user")

	logger := WithContext(ctx)
	if logger == nil {
		t.Error("Expected non-nil logger")
	}
}

func TestWithContextEmpty(t *testing.T) {
	Init(&Config{Level: "info", Format: "text"})

	ctx := context.Background()
	logger := WithContext(ctx)
	if logger == nil {
		t.Error("Expected non-nil logger")
	}
}

func TestLogFunctions(t *testing.T) {
	// Capture log output
	var buf bytes.Buffer
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	slog.SetDefault(slog.New(handler))

	ctx := context.Background()
	ctx = context.WithValue(ctx, RequestIDKey, "req-123")

	// Test all log functions
	Info(ctx, "info message", "key", "value")
	if !strings.Contains(buf.String(), "info message") {
		t.Error("Expected info message in log")
	}

	buf.Reset()
	Debug(ctx, "debug message")
	if !strings.Contains(buf.String(), "debug message") {
		t.Error("Expected debug message in log")
	}

	buf.Reset()
	Warn(ctx, "warn message")
	if !strings.Contains(buf.String(), "warn message") {
		t.Error("Expected warn message in log")
	}

	buf.Reset()
	Error(ctx, "error message")
	if !strings.Contains(buf.String(), "error message") {
		t.Error("Expected error message in log")
	}
}
