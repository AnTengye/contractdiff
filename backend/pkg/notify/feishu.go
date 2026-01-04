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
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
)

// FeishuNotifier sends notifications via Feishu webhook
type FeishuNotifier struct {
	webhookURL string
	secret     string
	client     *http.Client
}

// Feishu message types
type feishuMessage struct {
	MsgType string        `json:"msg_type"`
	Content feishuContent `json:"content"`
}

type feishuContentCard struct {
	MsgType string     `json:"msg_type"`
	Card    feishuCard `json:"card"`
}

type feishuCard struct {
	Header   feishuCardHeader    `json:"header"`
	Elements []feishuCardElement `json:"elements"`
}

type feishuCardHeader struct {
	Title    feishuCardTitle `json:"title"`
	Template string          `json:"template"`
}

type feishuCardTitle struct {
	Tag     string `json:"tag"`
	Content string `json:"content"`
}

type feishuCardElement struct {
	Tag     string          `json:"tag"`
	Content string          `json:"content,omitempty"`
	Text    *feishuCardText `json:"text,omitempty"`
}

type feishuCardText struct {
	Tag     string `json:"tag"`
	Content string `json:"content"`
}

type feishuContent struct {
	Text string `json:"text"`
}

type feishuSignedMessage struct {
	Timestamp string        `json:"timestamp"`
	Sign      string        `json:"sign"`
	MsgType   string        `json:"msg_type"`
	Content   feishuContent `json:"content"`
}

type feishuResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
}

// NewFeishuNotifier creates a new Feishu notifier
func NewFeishuNotifier(cfg *config.FeishuConfig) *FeishuNotifier {
	return &FeishuNotifier{
		webhookURL: cfg.WebhookURL,
		secret:     cfg.Secret,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Name returns the notifier name
func (f *FeishuNotifier) Name() string {
	return "Feishu"
}

// IsConfigured returns true if the notifier is properly configured
func (f *FeishuNotifier) IsConfigured() bool {
	return f.webhookURL != ""
}

// Send sends a text message to Feishu
func (f *FeishuNotifier) Send(title, content string) error {
	if !f.IsConfigured() {
		return fmt.Errorf("Feishu webhook URL is not configured")
	}

	// Combine title and content for text message
	fullContent := fmt.Sprintf("【%s】\n\n%s", title, content)

	var jsonData []byte
	var err error

	if f.secret != "" {
		// Use signed message
		timestamp, sign := f.generateSignature()
		msg := feishuSignedMessage{
			Timestamp: timestamp,
			Sign:      sign,
			MsgType:   "text",
			Content: feishuContent{
				Text: fullContent,
			},
		}
		jsonData, err = json.Marshal(msg)
	} else {
		// Use simple message
		msg := feishuMessage{
			MsgType: "text",
			Content: feishuContent{
				Text: fullContent,
			},
		}
		jsonData, err = json.Marshal(msg)
	}

	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	req, err := http.NewRequest("POST", f.webhookURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := f.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	var result feishuResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("failed to parse response: %w", err)
	}

	if result.Code != 0 {
		return fmt.Errorf("Feishu API error: %s (code: %d)", result.Msg, result.Code)
	}

	return nil
}

// generateSignature generates timestamp and signature for signed webhooks
// Following Feishu documentation: https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
func (f *FeishuNotifier) generateSignature() (string, string) {
	timestamp := time.Now().Unix()
	timestampStr := fmt.Sprintf("%d", timestamp)

	stringToSign := fmt.Sprintf("%s\n%s", timestampStr, f.secret)

	h := hmac.New(sha256.New, []byte(stringToSign))
	h.Write([]byte{})
	signature := base64.StdEncoding.EncodeToString(h.Sum(nil))

	return timestampStr, signature
}

// GenerateFeishuSignature exposes signature generation for testing
func GenerateFeishuSignature(secret string, timestamp int64) string {
	timestampStr := fmt.Sprintf("%d", timestamp)
	stringToSign := fmt.Sprintf("%s\n%s", timestampStr, secret)

	h := hmac.New(sha256.New, []byte(stringToSign))
	h.Write([]byte{})
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}
