package timing

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

type TraceContext struct {
	TraceID    string
	RequestID  string
	ContractID string
	Tenant     string
	Operation  string
}

type Step struct {
	Name      string
	Duration  time.Duration
	StartTime time.Time
	EndTime   time.Time
	Error     error
}

type Tracker struct {
	ctx       TraceContext
	threshold time.Duration
	start     time.Time
	steps     []Step
	mu        sync.Mutex
	alerter   Alerter
}

type TrackerOption func(*Tracker)

func WithAlerter(a Alerter) TrackerOption {
	return func(t *Tracker) {
		t.alerter = a
	}
}

func WithThreshold(d time.Duration) TrackerOption {
	return func(t *Tracker) {
		t.threshold = d
	}
}

func New(ctx TraceContext, opts ...TrackerOption) *Tracker {
	t := &Tracker{
		ctx:       ctx,
		threshold: 15 * time.Second,
		start:     time.Now(),
		steps:     make([]Step, 0, 8),
	}
	for _, opt := range opts {
		opt(t)
	}
	return t
}

func (t *Tracker) Track(name string, fn func() error) error {
	stepStart := time.Now()
	err := fn()
	duration := time.Since(stepStart)

	t.mu.Lock()
	t.steps = append(t.steps, Step{
		Name:      name,
		Duration:  duration,
		StartTime: stepStart,
		EndTime:   time.Now(),
		Error:     err,
	})
	t.mu.Unlock()

	if duration > t.threshold {
		slog.Warn("slow step",
			"trace_id", t.ctx.TraceID,
			"request_id", t.ctx.RequestID,
			"contract_id", t.ctx.ContractID,
			"operation", t.ctx.Operation,
			"step", name,
			"duration_ms", duration.Milliseconds(),
			"threshold_ms", t.threshold.Milliseconds(),
		)
	}

	return err
}

func (t *Tracker) Record(name string, duration time.Duration) {
	t.mu.Lock()
	t.steps = append(t.steps, Step{
		Name:     name,
		Duration: duration,
		EndTime:  time.Now(),
	})
	t.mu.Unlock()
}

func (t *Tracker) Finish() {
	total := time.Since(t.start)

	attrs := []any{
		"trace_id", t.ctx.TraceID,
		"request_id", t.ctx.RequestID,
		"contract_id", t.ctx.ContractID,
		"tenant", t.ctx.Tenant,
		"operation", t.ctx.Operation,
		"total_ms", total.Milliseconds(),
	}

	t.mu.Lock()
	steps := make([]Step, len(t.steps))
	copy(steps, t.steps)
	t.mu.Unlock()

	for _, s := range steps {
		attrs = append(attrs, s.Name+"_ms", s.Duration.Milliseconds())
	}

	slowOperation := total > t.threshold
	if slowOperation {
		slog.Warn("slow operation", attrs...)

		if t.alerter != nil {
			go t.alerter.Alert(t.ctx, total, steps)
		}
	} else {
		slog.Info("operation timing", attrs...)
	}
}

func (t *Tracker) TotalDuration() time.Duration {
	return time.Since(t.start)
}

func (t *Tracker) Steps() []Step {
	t.mu.Lock()
	defer t.mu.Unlock()
	result := make([]Step, len(t.steps))
	copy(result, t.steps)
	return result
}

func (t *Tracker) Context() TraceContext {
	return t.ctx
}

type trackerCtxKey struct{}

func WithTracker(ctx context.Context, tracker *Tracker) context.Context {
	return context.WithValue(ctx, trackerCtxKey{}, tracker)
}

func FromContext(ctx context.Context) *Tracker {
	if t, ok := ctx.Value(trackerCtxKey{}).(*Tracker); ok {
		return t
	}
	return nil
}

func FormatStepsTable(steps []Step) string {
	if len(steps) == 0 {
		return "No steps recorded"
	}

	result := "| Step | Duration |\n|------|----------|\n"
	for _, s := range steps {
		status := "✓"
		if s.Error != nil {
			status = "✗"
		}
		result += fmt.Sprintf("| %s %s | %dms |\n", status, s.Name, s.Duration.Milliseconds())
	}
	return result
}
