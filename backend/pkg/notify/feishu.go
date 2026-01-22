package notify

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/pkg/httpclient"
)

type FeishuNotifier struct {
	webhookURL string
	secret     string
	client     *httpclient.Client
}

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

func NewFeishuNotifier(cfg *config.FeishuConfig) *FeishuNotifier {
	return &FeishuNotifier{
		webhookURL: cfg.WebhookURL,
		secret:     cfg.Secret,
		client:     httpclient.NewWithTimeout(10 * time.Second),
	}
}

func (f *FeishuNotifier) Name() string {
	return "Feishu"
}

func (f *FeishuNotifier) IsConfigured() bool {
	return f.webhookURL != ""
}

func (f *FeishuNotifier) Send(title, content string) error {
	if !f.IsConfigured() {
		return fmt.Errorf("Feishu webhook URL is not configured")
	}

	fullContent := fmt.Sprintf("【%s】\n\n%s", title, content)

	var body interface{}

	if f.secret != "" {
		timestamp, sign := f.generateSignature()
		body = feishuSignedMessage{
			Timestamp: timestamp,
			Sign:      sign,
			MsgType:   "text",
			Content: feishuContent{
				Text: fullContent,
			},
		}
	} else {
		body = feishuMessage{
			MsgType: "text",
			Content: feishuContent{
				Text: fullContent,
			},
		}
	}

	ctx := context.Background()
	resp, err := f.client.R(ctx).
		SetHeader("Content-Type", "application/json").
		SetBody(body).
		Post(f.webhookURL)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}

	var result feishuResponse
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return fmt.Errorf("failed to parse response: %w", err)
	}

	if result.Code != 0 {
		return fmt.Errorf("Feishu API error: %s (code: %d)", result.Msg, result.Code)
	}

	return nil
}

func (f *FeishuNotifier) generateSignature() (string, string) {
	timestamp := time.Now().Unix()
	timestampStr := fmt.Sprintf("%d", timestamp)

	stringToSign := fmt.Sprintf("%s\n%s", timestampStr, f.secret)

	h := hmac.New(sha256.New, []byte(stringToSign))
	h.Write([]byte{})
	signature := base64.StdEncoding.EncodeToString(h.Sum(nil))

	return timestampStr, signature
}

func GenerateFeishuSignature(secret string, timestamp int64) string {
	timestampStr := fmt.Sprintf("%d", timestamp)
	stringToSign := fmt.Sprintf("%s\n%s", timestampStr, secret)

	h := hmac.New(sha256.New, []byte(stringToSign))
	h.Write([]byte{})
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}
