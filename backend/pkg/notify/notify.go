// Package notify provides webhook notification functionality for DingTalk and Feishu.
package notify

import (
	"fmt"
	"log/slog"

	"github.com/AnTengye/contractdiff/backend/config"
)

// Notifier interface for sending notifications
type Notifier interface {
	// Send sends a notification with the given title and content
	Send(title, content string) error
	// Name returns the name of the notifier for logging
	Name() string
	// IsConfigured returns true if the notifier is properly configured
	IsConfigured() bool
}

// Manager manages multiple notifiers and sends notifications to all of them
type Manager struct {
	notifiers []Notifier
}

// NewManager creates a new notification manager from config
func NewManager(cfg *config.NotificationConfig) *Manager {
	m := &Manager{
		notifiers: make([]Notifier, 0),
	}

	// Add DingTalk notifier if configured
	if cfg.DingTalk.WebhookURL != "" {
		m.notifiers = append(m.notifiers, NewDingTalkNotifier(&cfg.DingTalk))
		slog.Info("DingTalk notifier configured")
	}

	// Add Feishu notifier if configured
	if cfg.Feishu.WebhookURL != "" {
		m.notifiers = append(m.notifiers, NewFeishuNotifier(&cfg.Feishu))
		slog.Info("Feishu notifier configured")
	}

	if len(m.notifiers) == 0 {
		slog.Warn("No notification channels configured, token expiration reminders will only be logged")
	}

	return m
}

// HasNotifiers returns true if at least one notifier is configured
func (m *Manager) HasNotifiers() bool {
	return len(m.notifiers) > 0
}

// SendToAll sends a notification to all configured notifiers
// Returns an error if any notifier fails, but attempts to send to all
func (m *Manager) SendToAll(title, content string) error {
	if len(m.notifiers) == 0 {
		slog.Warn("No notifiers configured, skipping notification",
			"title", title,
		)
		return nil
	}

	var errs []error
	for _, n := range m.notifiers {
		if err := n.Send(title, content); err != nil {
			slog.Error("Failed to send notification",
				"notifier", n.Name(),
				"error", err,
			)
			errs = append(errs, fmt.Errorf("%s: %w", n.Name(), err))
		} else {
			slog.Info("Notification sent successfully",
				"notifier", n.Name(),
				"title", title,
			)
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("failed to send %d notifications: %v", len(errs), errs)
	}
	return nil
}
