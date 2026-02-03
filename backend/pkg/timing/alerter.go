package timing

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/AnTengye/contractdiff/backend/pkg/notify"
)

type Alerter interface {
	Alert(ctx TraceContext, total time.Duration, steps []Step)
}

type DingTalkAlerter struct {
	notifyManager *notify.Manager
	cooldown      time.Duration
	lastAlert     map[string]time.Time
	mu            sync.Mutex
}

func NewDingTalkAlerter(manager *notify.Manager, cooldownMinutes int) *DingTalkAlerter {
	return &DingTalkAlerter{
		notifyManager: manager,
		cooldown:      time.Duration(cooldownMinutes) * time.Minute,
		lastAlert:     make(map[string]time.Time),
	}
}

func (a *DingTalkAlerter) Alert(ctx TraceContext, total time.Duration, steps []Step) {
	if a.notifyManager == nil || !a.notifyManager.HasNotifiers() {
		return
	}

	key := fmt.Sprintf("%s:%s", ctx.Operation, ctx.ContractID)

	a.mu.Lock()
	if last, ok := a.lastAlert[key]; ok && time.Since(last) < a.cooldown {
		a.mu.Unlock()
		slog.Debug("alert cooldown active",
			"operation", ctx.Operation,
			"contract_id", ctx.ContractID,
			"cooldown_remaining_s", (a.cooldown - time.Since(last)).Seconds(),
		)
		return
	}
	a.lastAlert[key] = time.Now()
	a.mu.Unlock()

	title := fmt.Sprintf("⚠️ 慢操作告警: %s", ctx.Operation)

	content := fmt.Sprintf(`**追踪信息**
- TraceID: %s
- RequestID: %s
- ContractID: %s
- Tenant: %s
- 总耗时: %dms

**各步骤耗时**
%s`,
		ctx.TraceID,
		ctx.RequestID,
		ctx.ContractID,
		ctx.Tenant,
		total.Milliseconds(),
		FormatStepsTable(steps),
	)

	if err := a.notifyManager.SendToAll(title, content); err != nil {
		slog.Error("failed to send slow operation alert",
			"trace_id", ctx.TraceID,
			"error", err,
		)
	}
}

type NoopAlerter struct{}

func (n *NoopAlerter) Alert(ctx TraceContext, total time.Duration, steps []Step) {}
