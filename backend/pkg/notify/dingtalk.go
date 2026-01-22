package notify

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/pkg/httpclient"
)

type DingTalkNotifier struct {
	webhookURL string
	secret     string
	client     *httpclient.Client
}

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

func NewDingTalkNotifier(cfg *config.DingTalkConfig) *DingTalkNotifier {
	return &DingTalkNotifier{
		webhookURL: cfg.WebhookURL,
		secret:     cfg.Secret,
		client:     httpclient.NewWithTimeout(10 * time.Second),
	}
}

func (d *DingTalkNotifier) Name() string {
	return "DingTalk"
}

func (d *DingTalkNotifier) IsConfigured() bool {
	return d.webhookURL != ""
}

func (d *DingTalkNotifier) Send(title, content string) error {
	if !d.IsConfigured() {
		return fmt.Errorf("DingTalk webhook URL is not configured")
	}

	webhookURL := d.webhookURL
	if d.secret != "" {
		timestamp, sign := d.generateSignature()
		separator := "&"
		if !strings.Contains(d.webhookURL, "?") {
			separator = "?"
		}
		webhookURL = fmt.Sprintf("%s%stimestamp=%d&sign=%s", d.webhookURL, separator, timestamp, url.QueryEscape(sign))
	}

	msg := dingTalkMessage{
		MsgType: "markdown",
		Markdown: dingTalkMarkdown{
			Title: title,
			Text:  fmt.Sprintf("## %s\n\n%s", title, content),
		},
	}

	ctx := context.Background()
	resp, err := d.client.R(ctx).
		SetHeader("Content-Type", "application/json").
		SetBody(msg).
		Post(webhookURL)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}

	var result dingTalkResponse
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return fmt.Errorf("failed to parse response: %w", err)
	}

	if result.ErrCode != 0 {
		return fmt.Errorf("DingTalk API error: %s (code: %d)", result.ErrMsg, result.ErrCode)
	}

	return nil
}

func (d *DingTalkNotifier) generateSignature() (int64, string) {
	timestamp := time.Now().UnixMilli()
	stringToSign := fmt.Sprintf("%d\n%s", timestamp, d.secret)

	h := hmac.New(sha256.New, []byte(d.secret))
	h.Write([]byte(stringToSign))
	signature := base64.StdEncoding.EncodeToString(h.Sum(nil))

	return timestamp, signature
}

func GenerateDingTalkSignature(secret string, timestamp int64) string {
	stringToSign := fmt.Sprintf("%d\n%s", timestamp, secret)
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}
