package service

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/pkg/notify"
)

// TokenChecker checks MinerU token expiration and sends notifications
type TokenChecker struct {
	config        *config.Config
	notifier      *notify.Manager
	ticker        *time.Ticker
	done          chan bool
	mu            sync.Mutex
	lastNotifyDay int // Track the last day we sent a notification for (to avoid duplicates)
	running       bool
}

// ReminderDays defines when to send reminders (days before expiration)
var ReminderDays = []int{7, 3, 1, 0}

// NewTokenChecker creates a new token expiration checker
func NewTokenChecker(cfg *config.Config, notifier *notify.Manager) *TokenChecker {
	return &TokenChecker{
		config:        cfg,
		notifier:      notifier,
		done:          make(chan bool),
		lastNotifyDay: -1, // -1 means no notification sent yet
	}
}

// Start begins the background token expiration checking routine
func (c *TokenChecker) Start() {
	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return
	}
	c.running = true
	c.mu.Unlock()

	// Check if token_created_at is configured
	if c.config.Mineru.TokenCreatedAt == "" {
		slog.Warn("MinerU token_created_at is not configured, token expiration checking is disabled")
		return
	}

	// Parse the token creation time
	_, err := time.Parse(time.RFC3339, c.config.Mineru.TokenCreatedAt)
	if err != nil {
		slog.Error("Failed to parse token_created_at, token expiration checking is disabled",
			"value", c.config.Mineru.TokenCreatedAt,
			"error", err,
		)
		return
	}

	// Set up the ticker
	interval := time.Duration(c.config.Notification.CheckIntervalHours) * time.Hour
	c.ticker = time.NewTicker(interval)

	slog.Info("Token expiration checker started",
		"check_interval_hours", c.config.Notification.CheckIntervalHours,
		"token_valid_days", c.config.Mineru.TokenValidDays,
	)

	// Check immediately on startup
	go func() {
		c.checkExpiration()

		for {
			select {
			case <-c.done:
				return
			case <-c.ticker.C:
				c.checkExpiration()
			}
		}
	}()
}

// Stop gracefully stops the token checker
func (c *TokenChecker) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.running {
		return
	}

	if c.ticker != nil {
		c.ticker.Stop()
	}
	close(c.done)
	c.running = false
	slog.Info("Token expiration checker stopped")
}

// checkExpiration checks if token is about to expire and sends notifications
func (c *TokenChecker) checkExpiration() {
	daysRemaining, err := c.CalculateDaysRemaining(time.Now())
	if err != nil {
		slog.Error("Failed to calculate days remaining", "error", err)
		return
	}

	slog.Debug("Token expiration check",
		"days_remaining", daysRemaining,
		"last_notify_day", c.lastNotifyDay,
	)

	// Check if we should send a notification
	shouldNotify, reminderDay := ShouldNotify(daysRemaining, ReminderDays)
	if !shouldNotify {
		return
	}

	// Avoid duplicate notifications for the same reminder day
	c.mu.Lock()
	if c.lastNotifyDay == reminderDay {
		c.mu.Unlock()
		slog.Debug("Notification already sent for this reminder day", "day", reminderDay)
		return
	}
	c.lastNotifyDay = reminderDay
	c.mu.Unlock()

	// Send notification
	title, content := c.buildNotificationMessage(daysRemaining)
	slog.Info("Sending token expiration notification",
		"days_remaining", daysRemaining,
		"title", title,
	)

	if err := c.notifier.SendToAll(title, content); err != nil {
		slog.Error("Failed to send token expiration notification", "error", err)
	}
}

// CalculateDaysRemaining calculates how many days until the token expires
func (c *TokenChecker) CalculateDaysRemaining(now time.Time) (int, error) {
	createdAt, err := time.Parse(time.RFC3339, c.config.Mineru.TokenCreatedAt)
	if err != nil {
		return 0, fmt.Errorf("failed to parse token_created_at: %w", err)
	}

	expiresAt := createdAt.AddDate(0, 0, c.config.Mineru.TokenValidDays)
	daysRemaining := int(expiresAt.Sub(now).Hours() / 24)

	return daysRemaining, nil
}

// buildNotificationMessage builds the notification title and content
func (c *TokenChecker) buildNotificationMessage(daysRemaining int) (string, string) {
	var title, content string

	if daysRemaining <= 0 {
		title = "⚠️ 解析工具 Token 已过期"
		content = fmt.Sprintf("**紧急**：解析工具 API Token 已过期！\n\n"+
			"请立即更新 Token 以恢复服务。\n\n"+
			"**Token 创建时间**：%s\n"+
			"**有效期**：%d 天\n\n"+
			"更新后请修改配置文件中的 `mineru.api_token` 和 `mineru.token_created_at`",
			c.config.Mineru.TokenCreatedAt,
			c.config.Mineru.TokenValidDays,
		)
	} else {
		title = fmt.Sprintf("⏰ 解析工具 Token 将在 %d 天后过期", daysRemaining)
		content = fmt.Sprintf("**提醒**：解析工具 API Token 即将过期。\n\n"+
			"**剩余时间**：%d 天\n"+
			"**Token 创建时间**：%s\n"+
			"**有效期**：%d 天\n\n"+
			"请及时更新 Token，更新后请修改配置文件中的 `mineru.api_token` 和 `mineru.token_created_at`",
			daysRemaining,
			c.config.Mineru.TokenCreatedAt,
			c.config.Mineru.TokenValidDays,
		)
	}

	return title, content
}

// ShouldNotify determines if a notification should be sent based on days remaining
// Returns (shouldNotify, matchedReminderDay)
func ShouldNotify(daysRemaining int, reminderDays []int) (bool, int) {
	for _, day := range reminderDays {
		if daysRemaining == day {
			return true, day
		}
		// If days remaining is less than the smallest reminder day, still notify for expired
		if daysRemaining < 0 && day == 0 {
			return true, 0
		}
	}
	return false, -1
}

// CalculateDaysRemainingFromConfig is a utility function for external use
func CalculateDaysRemainingFromConfig(cfg *config.MineruConfig, now time.Time) (int, error) {
	if cfg.TokenCreatedAt == "" {
		return 0, fmt.Errorf("token_created_at is not configured")
	}

	createdAt, err := time.Parse(time.RFC3339, cfg.TokenCreatedAt)
	if err != nil {
		return 0, fmt.Errorf("failed to parse token_created_at: %w", err)
	}

	validDays := cfg.TokenValidDays
	if validDays == 0 {
		validDays = 14 // Default
	}

	expiresAt := createdAt.AddDate(0, 0, validDays)
	daysRemaining := int(expiresAt.Sub(now).Hours() / 24)

	return daysRemaining, nil
}
