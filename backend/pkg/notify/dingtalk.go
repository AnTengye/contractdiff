package notify

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
)

// DingTalkNotifier sends notifications via DingTalk webhook
type DingTalkNotifier struct {
	webhookURL string
	secret     string
	client     *http.Client
}

// DingTalk message types
type dingTalkMessage struct {
	MsgType  string           `json:"msgtype"`
	Markdown dingTalkMarkdown `json:"markdown"`
}

type dingTalkMarkdown struct {
	Title string `json:"title"`
	Text  string `json:"text"`
}

type dingTalkResponse struct {
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
}

// NewDingTalkNotifier creates a new DingTalk notifier
func NewDingTalkNotifier(cfg *config.DingTalkConfig) *DingTalkNotifier {
	return &DingTalkNotifier{
		webhookURL: cfg.WebhookURL,
		secret:     cfg.Secret,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Name returns the notifier name
func (d *DingTalkNotifier) Name() string {
	return "DingTalk"
}

// IsConfigured returns true if the notifier is properly configured
func (d *DingTalkNotifier) IsConfigured() bool {
	return d.webhookURL != ""
}

// Send sends a markdown message to DingTalk
func (d *DingTalkNotifier) Send(title, content string) error {
	if !d.IsConfigured() {
		return fmt.Errorf("DingTalk webhook URL is not configured")
	}

	// Build the webhook URL with signature if secret is provided
	webhookURL := d.webhookURL
	if d.secret != "" {
		timestamp, sign := d.generateSignature()
		// Check if URL already has query parameters
		separator := "&"
		if !strings.Contains(d.webhookURL, "?") {
			separator = "?"
		}
		webhookURL = fmt.Sprintf("%s%stimestamp=%d&sign=%s", d.webhookURL, separator, timestamp, url.QueryEscape(sign))
	}

	// Build markdown message
	msg := dingTalkMessage{
		MsgType: "markdown",
		Markdown: dingTalkMarkdown{
			Title: title,
			Text:  fmt.Sprintf("## %s\n\n%s", title, content),
		},
	}

	jsonData, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	req, err := http.NewRequest("POST", webhookURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	var result dingTalkResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("failed to parse response: %w", err)
	}

	if result.ErrCode != 0 {
		return fmt.Errorf("DingTalk API error: %s (code: %d)", result.ErrMsg, result.ErrCode)
	}

	return nil
}

// generateSignature generates timestamp and signature for signed webhooks
// Following DingTalk documentation: https://open.dingtalk.com/document/robots/customize-robot-security-settings
func (d *DingTalkNotifier) generateSignature() (int64, string) {
	timestamp := time.Now().UnixMilli()
	stringToSign := fmt.Sprintf("%d\n%s", timestamp, d.secret)

	h := hmac.New(sha256.New, []byte(d.secret))
	h.Write([]byte(stringToSign))
	signature := base64.StdEncoding.EncodeToString(h.Sum(nil))

	return timestamp, signature
}

// GenerateSignatureForTest exposes signature generation for testing
func GenerateDingTalkSignature(secret string, timestamp int64) string {
	stringToSign := fmt.Sprintf("%d\n%s", timestamp, secret)
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}
