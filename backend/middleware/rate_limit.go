package middleware

import (
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimiter implements a simple token bucket rate limiter
type RateLimiter struct {
	mu        sync.Mutex
	tokens    map[string]int
	lastReset time.Time
	rate      int           // requests per window
	window    time.Duration // time window
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(rate int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		tokens:    make(map[string]int),
		lastReset: time.Now(),
		rate:      rate,
		window:    window,
	}
}

// RateLimit middleware limits requests per IP
func RateLimit(rate int, window time.Duration) gin.HandlerFunc {
	limiter := NewRateLimiter(rate, window)

	return func(c *gin.Context) {
		clientIP := c.ClientIP()

		limiter.mu.Lock()

		// Reset if window has passed
		if time.Since(limiter.lastReset) > limiter.window {
			limiter.tokens = make(map[string]int)
			limiter.lastReset = time.Now()
		}

		// Check and increment token count
		count := limiter.tokens[clientIP]
		if count >= limiter.rate {
			limiter.mu.Unlock()

			slog.Warn("rate limit exceeded",
				"client_ip", clientIP,
				"request_id", GetRequestID(c),
			)

			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded. Please try again later.",
			})
			return
		}

		limiter.tokens[clientIP] = count + 1
		limiter.mu.Unlock()

		c.Next()
	}
}
