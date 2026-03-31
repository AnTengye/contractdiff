package service

import (
	"testing"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/pkg/notify"
)

func TestCalculateDaysRemaining(t *testing.T) {
	tests := []struct {
		name           string
		tokenCreatedAt string
		tokenValidDays int
		now            time.Time
		expectedDays   int
		expectError    bool
	}{
		{
			name:           "7 days remaining",
			tokenCreatedAt: "2026-01-01T00:00:00+08:00",
			tokenValidDays: 14,
			now:            mustParseTime("2026-01-08T00:00:00+08:00"),
			expectedDays:   7,
		},
		{
			name:           "3 days remaining",
			tokenCreatedAt: "2026-01-01T00:00:00+08:00",
			tokenValidDays: 14,
			now:            mustParseTime("2026-01-12T00:00:00+08:00"),
			expectedDays:   3,
		},
		{
			name:           "1 day remaining",
			tokenCreatedAt: "2026-01-01T00:00:00+08:00",
			tokenValidDays: 14,
			now:            mustParseTime("2026-01-14T00:00:00+08:00"),
			expectedDays:   1,
		},
		{
			name:           "0 days remaining (expires today)",
			tokenCreatedAt: "2026-01-01T00:00:00+08:00",
			tokenValidDays: 14,
			now:            mustParseTime("2026-01-15T00:00:00+08:00"),
			expectedDays:   0,
		},
		{
			name:           "expired 1 day ago",
			tokenCreatedAt: "2026-01-01T00:00:00+08:00",
			tokenValidDays: 14,
			now:            mustParseTime("2026-01-16T00:00:00+08:00"),
			expectedDays:   -1,
		},
		{
			name:           "14 days remaining (just created)",
			tokenCreatedAt: "2026-01-01T00:00:00+08:00",
			tokenValidDays: 14,
			now:            mustParseTime("2026-01-01T00:00:00+08:00"),
			expectedDays:   14,
		},
		{
			name:           "invalid date format",
			tokenCreatedAt: "invalid-date",
			tokenValidDays: 14,
			now:            time.Now(),
			expectError:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &config.Config{
				Parsers: config.ParsersConfig{
					MinerU: &config.MineruConfig{
						TokenCreatedAt: tt.tokenCreatedAt,
						TokenValidDays: tt.tokenValidDays,
					},
				},
			}
			checker := NewTokenChecker(cfg, nil)

			days, err := checker.CalculateDaysRemaining(tt.now)
			if tt.expectError {
				if err == nil {
					t.Error("Expected error, got nil")
				}
				return
			}

			if err != nil {
				t.Errorf("Unexpected error: %v", err)
				return
			}

			if days != tt.expectedDays {
				t.Errorf("Expected %d days, got %d", tt.expectedDays, days)
			}
		})
	}
}

func TestShouldNotify(t *testing.T) {
	tests := []struct {
		name          string
		daysRemaining int
		reminderDays  []int
		shouldNotify  bool
		expectedDay   int
	}{
		{
			name:          "7 days - should notify",
			daysRemaining: 7,
			reminderDays:  []int{7, 3, 1, 0},
			shouldNotify:  true,
			expectedDay:   7,
		},
		{
			name:          "3 days - should notify",
			daysRemaining: 3,
			reminderDays:  []int{7, 3, 1, 0},
			shouldNotify:  true,
			expectedDay:   3,
		},
		{
			name:          "1 day - should notify",
			daysRemaining: 1,
			reminderDays:  []int{7, 3, 1, 0},
			shouldNotify:  true,
			expectedDay:   1,
		},
		{
			name:          "0 days (expires today) - should notify",
			daysRemaining: 0,
			reminderDays:  []int{7, 3, 1, 0},
			shouldNotify:  true,
			expectedDay:   0,
		},
		{
			name:          "expired - should notify on 0 day rule",
			daysRemaining: -1,
			reminderDays:  []int{7, 3, 1, 0},
			shouldNotify:  true,
			expectedDay:   0,
		},
		{
			name:          "5 days - should not notify",
			daysRemaining: 5,
			reminderDays:  []int{7, 3, 1, 0},
			shouldNotify:  false,
			expectedDay:   -1,
		},
		{
			name:          "10 days - should not notify",
			daysRemaining: 10,
			reminderDays:  []int{7, 3, 1, 0},
			shouldNotify:  false,
			expectedDay:   -1,
		},
		{
			name:          "2 days - should not notify",
			daysRemaining: 2,
			reminderDays:  []int{7, 3, 1, 0},
			shouldNotify:  false,
			expectedDay:   -1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			shouldNotify, day := ShouldNotify(tt.daysRemaining, tt.reminderDays)
			if shouldNotify != tt.shouldNotify {
				t.Errorf("ShouldNotify() = %v, expected %v", shouldNotify, tt.shouldNotify)
			}
			if day != tt.expectedDay {
				t.Errorf("ShouldNotify() day = %d, expected %d", day, tt.expectedDay)
			}
		})
	}
}

func TestTokenChecker_BuildNotificationMessage(t *testing.T) {
	cfg := &config.Config{
				Parsers: config.ParsersConfig{
					MinerU: &config.MineruConfig{
						TokenCreatedAt: "2026-01-01T00:00:00+08:00",
						TokenValidDays: 14,
					},
				},
	}
	checker := NewTokenChecker(cfg, nil)

	// Test expired message
	title, content := checker.buildNotificationMessage(-1)
	if title == "" || content == "" {
		t.Error("Expected non-empty title and content for expired token")
	}
	if title != "⚠️ 解析工具 Token 已过期" {
		t.Errorf("Unexpected title for expired token: %s", title)
	}

	// Test reminder message
	title, content = checker.buildNotificationMessage(7)
	if title == "" || content == "" {
		t.Error("Expected non-empty title and content for reminder")
	}
	if title != "⏰ 解析工具 Token 将在 7 天后过期" {
		t.Errorf("Unexpected title for 7-day reminder: %s", title)
	}
}

func TestTokenChecker_StartStop(t *testing.T) {
	cfg := &config.Config{
		Parsers: config.ParsersConfig{
			MinerU: &config.MineruConfig{
				TokenCreatedAt: "2026-01-01T00:00:00+08:00",
				TokenValidDays: 14,
			},
		},
		Notification: config.NotificationConfig{
			CheckIntervalHours: 12,
		},
	}
	notifier := notify.NewManager(&config.NotificationConfig{})
	checker := NewTokenChecker(cfg, notifier)

	// Start should work without panic
	checker.Start()

	// Give it a moment to start
	time.Sleep(100 * time.Millisecond)

	// Stop should work without panic
	checker.Stop()

	// Double stop should be safe
	checker.Stop()
}

func TestTokenChecker_NoConfig(t *testing.T) {
	cfg := &config.Config{
		Parsers: config.ParsersConfig{
			MinerU: &config.MineruConfig{
				// No TokenCreatedAt configured
			},
		},
		Notification: config.NotificationConfig{
			CheckIntervalHours: 12,
		},
	}
	notifier := notify.NewManager(&config.NotificationConfig{})
	checker := NewTokenChecker(cfg, notifier)

	// Start should handle missing config gracefully
	checker.Start()

	// Should not be running because of missing config
	time.Sleep(100 * time.Millisecond)
	checker.Stop()
}

func TestCalculateDaysRemainingFromConfig(t *testing.T) {
	tests := []struct {
		name         string
		cfg          *config.MineruConfig
		now          time.Time
		expectedDays int
		expectError  bool
	}{
		{
			name: "valid config",
			cfg: &config.MineruConfig{
				TokenCreatedAt: "2026-01-01T00:00:00+08:00",
				TokenValidDays: 14,
			},
			now:          mustParseTime("2026-01-08T00:00:00+08:00"),
			expectedDays: 7,
		},
		{
			name: "default valid days",
			cfg: &config.MineruConfig{
				TokenCreatedAt: "2026-01-01T00:00:00+08:00",
				TokenValidDays: 0, // Should default to 14
			},
			now:          mustParseTime("2026-01-08T00:00:00+08:00"),
			expectedDays: 7,
		},
		{
			name: "no token_created_at",
			cfg: &config.MineruConfig{
				TokenCreatedAt: "",
			},
			expectError: true,
		},
		{
			name: "invalid date",
			cfg: &config.MineruConfig{
				TokenCreatedAt: "invalid",
			},
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			days, err := CalculateDaysRemainingFromConfig(tt.cfg, tt.now)
			if tt.expectError {
				if err == nil {
					t.Error("Expected error, got nil")
				}
				return
			}

			if err != nil {
				t.Errorf("Unexpected error: %v", err)
				return
			}

			if days != tt.expectedDays {
				t.Errorf("Expected %d days, got %d", tt.expectedDays, days)
			}
		})
	}
}

func mustParseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}
