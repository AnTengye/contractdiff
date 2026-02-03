package timing

import (
	"log/slog"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	TraceIDKey = "trace_id"
	TrackerKey = "timing_tracker"
)

type MiddlewareConfig struct {
	Enabled          bool
	RequestThreshold time.Duration
	Alerter          Alerter
}

func NewMiddlewareConfig(cfg *config.TimingConfig, alerter Alerter) MiddlewareConfig {
	return MiddlewareConfig{
		Enabled:          cfg.Enabled,
		RequestThreshold: time.Duration(cfg.RequestThresholdMs) * time.Millisecond,
		Alerter:          alerter,
	}
}

func Middleware(cfg MiddlewareConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.Enabled {
			c.Next()
			return
		}

		traceID := c.GetHeader("X-Trace-ID")
		if traceID == "" {
			traceID = uuid.New().String()
		}

		c.Set(TraceIDKey, traceID)
		c.Header("X-Trace-ID", traceID)

		requestID, _ := c.Get("request_id")
		requestIDStr, _ := requestID.(string)

		start := time.Now()

		c.Next()

		duration := time.Since(start)

		if duration > cfg.RequestThreshold {
			attrs := []any{
				"trace_id", traceID,
				"request_id", requestIDStr,
				"method", c.Request.Method,
				"path", c.Request.URL.Path,
				"status", c.Writer.Status(),
				"duration_ms", duration.Milliseconds(),
				"threshold_ms", cfg.RequestThreshold.Milliseconds(),
			}
			slog.Warn("slow request", attrs...)

			if cfg.Alerter != nil {
				ctx := TraceContext{
					TraceID:   traceID,
					RequestID: requestIDStr,
					Operation: c.Request.Method + " " + c.Request.URL.Path,
				}
				go cfg.Alerter.Alert(ctx, duration, nil)
			}
		}
	}
}

func GetTraceID(c *gin.Context) string {
	if traceID, exists := c.Get(TraceIDKey); exists {
		return traceID.(string)
	}
	return ""
}

func NewAsyncTracker(traceID, requestID, contractID, tenant, operation string, cfg *config.TimingConfig, alerter Alerter) *Tracker {
	threshold := time.Duration(cfg.AsyncThresholdMs) * time.Millisecond

	var opts []TrackerOption
	opts = append(opts, WithThreshold(threshold))
	if cfg.EnableAlert && alerter != nil {
		opts = append(opts, WithAlerter(alerter))
	}

	return New(TraceContext{
		TraceID:    traceID,
		RequestID:  requestID,
		ContractID: contractID,
		Tenant:     tenant,
		Operation:  operation,
	}, opts...)
}
