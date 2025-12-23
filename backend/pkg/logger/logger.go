package logger

import (
	"context"
	"log/slog"
	"os"
)

// ContextKey is a custom type for context keys to avoid collisions
type ContextKey string

const (
	// RequestIDKey is the context key for request ID
	RequestIDKey ContextKey = "request_id"
	// TenantKey is the context key for tenant
	TenantKey ContextKey = "tenant"
	// UsernameKey is the context key for username
	UsernameKey ContextKey = "username"
)

// Config holds logger configuration
type Config struct {
	Level  string // debug, info, warn, error
	Format string // json, text
}

// Init initializes the global slog logger with the given configuration
func Init(cfg *Config) {
	var level slog.Level
	switch cfg.Level {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{
		Level: level,
	}

	var handler slog.Handler
	if cfg.Format == "json" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}

	slog.SetDefault(slog.New(handler))
}

// WithContext returns a logger with context values extracted
func WithContext(ctx context.Context) *slog.Logger {
	logger := slog.Default()

	if requestID, ok := ctx.Value(RequestIDKey).(string); ok && requestID != "" {
		logger = logger.With("request_id", requestID)
	}
	if tenant, ok := ctx.Value(TenantKey).(string); ok && tenant != "" {
		logger = logger.With("tenant", tenant)
	}
	if username, ok := ctx.Value(UsernameKey).(string); ok && username != "" {
		logger = logger.With("username", username)
	}

	return logger
}

// Info logs at info level with context
func Info(ctx context.Context, msg string, args ...any) {
	WithContext(ctx).Info(msg, args...)
}

// Debug logs at debug level with context
func Debug(ctx context.Context, msg string, args ...any) {
	WithContext(ctx).Debug(msg, args...)
}

// Warn logs at warn level with context
func Warn(ctx context.Context, msg string, args ...any) {
	WithContext(ctx).Warn(msg, args...)
}

// Error logs at error level with context
func Error(ctx context.Context, msg string, args ...any) {
	WithContext(ctx).Error(msg, args...)
}
