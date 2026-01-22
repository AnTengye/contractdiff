package httpclient

import (
	"context"
	"log/slog"
	"time"

	"github.com/go-resty/resty/v2"
)

// DefaultRetryCount is the default number of retries for HTTP requests
const DefaultRetryCount = 3

// DefaultTimeout is the default timeout for HTTP requests
const DefaultTimeout = 60 * time.Second

// Client wraps resty.Client with pre-configured retry and logging
type Client struct {
	*resty.Client
}

// New creates a new HTTP client with retry support (3 retries by default)
func New() *Client {
	return NewWithOptions(DefaultTimeout, DefaultRetryCount)
}

// NewWithTimeout creates a new HTTP client with custom timeout
func NewWithTimeout(timeout time.Duration) *Client {
	return NewWithOptions(timeout, DefaultRetryCount)
}

// NewWithOptions creates a new HTTP client with custom timeout and retry count
func NewWithOptions(timeout time.Duration, retryCount int) *Client {
	client := resty.New().
		SetTimeout(timeout).
		SetRetryCount(retryCount).
		SetRetryWaitTime(1 * time.Second).
		SetRetryMaxWaitTime(5 * time.Second).
		AddRetryCondition(func(r *resty.Response, err error) bool {
			// Retry on network errors
			if err != nil {
				slog.Debug("retrying request due to error", "error", err)
				return true
			}
			// Retry on 5xx server errors and 429 rate limit
			if r.StatusCode() >= 500 || r.StatusCode() == 429 {
				slog.Debug("retrying request due to status code", "status", r.StatusCode())
				return true
			}
			return false
		}).
		OnBeforeRequest(func(c *resty.Client, r *resty.Request) error {
			slog.Debug("http request",
				"method", r.Method,
				"url", r.URL,
			)
			return nil
		}).
		OnAfterResponse(func(c *resty.Client, r *resty.Response) error {
			slog.Debug("http response",
				"method", r.Request.Method,
				"url", r.Request.URL,
				"status", r.StatusCode(),
				"duration_ms", r.Time().Milliseconds(),
			)
			return nil
		})

	return &Client{Client: client}
}

// R creates a new request with context
func (c *Client) R(ctx context.Context) *resty.Request {
	return c.Client.R().SetContext(ctx)
}

// Get performs a GET request with context
func (c *Client) Get(ctx context.Context, url string) (*resty.Response, error) {
	return c.R(ctx).Get(url)
}

// Post performs a POST request with context
func (c *Client) Post(ctx context.Context, url string, body interface{}) (*resty.Response, error) {
	return c.R(ctx).SetBody(body).Post(url)
}

// PostJSON performs a POST request with JSON body
func (c *Client) PostJSON(ctx context.Context, url string, body interface{}) (*resty.Response, error) {
	return c.R(ctx).
		SetHeader("Content-Type", "application/json").
		SetBody(body).
		Post(url)
}
