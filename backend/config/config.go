package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server       ServerConfig       `yaml:"server"`
	Minio        MinioConfig        `yaml:"minio"`
	Parsers      ParsersConfig      `yaml:"parsers"`   // NEW: Multi-parser config
	Gotenberg    GotenbergConfig    `yaml:"gotenberg"` // NEW: DOCX to PDF conversion
	Auth         AuthConfig         `yaml:"auth"`
	Log          LogConfig          `yaml:"log"`
	Store        StoreConfig        `yaml:"store"`
	Notification NotificationConfig `yaml:"notification"`
	Timing       TimingConfig       `yaml:"timing"` // Performance timing and alerting
	Users        []User             `yaml:"users"`
}

type LogConfig struct {
	Level  string `yaml:"level"`  // debug, info, warn, error
	Format string `yaml:"format"` // json, text
}

type ServerConfig struct {
	Port int `yaml:"port"`
}

type MinioConfig struct {
	Endpoint   string `yaml:"endpoint"`
	AccessKey  string `yaml:"access_key"`
	SecretKey  string `yaml:"secret_key"`
	Bucket     string `yaml:"bucket"`
	UseSSL     bool   `yaml:"use_ssl"`
	ExpireDays int    `yaml:"expire_days"`
}

type MineruConfig struct {
	Enabled        bool   `yaml:"enabled"` // NEW: Enable/disable this parser
	APIURL         string `yaml:"api_url"`
	APIToken       string `yaml:"api_token"`
	ModelVersion   string `yaml:"model_version"`
	CallbackURL    string `yaml:"callback_url"`
	Seed           string `yaml:"seed"`
	TokenCreatedAt string `yaml:"token_created_at"` // RFC3339 format, when token was created/refreshed
	TokenValidDays int    `yaml:"token_valid_days"` // Token validity period in days, default 14
}

// ParsersConfig contains configuration for all parsers
type ParsersConfig struct {
	Default   string           `yaml:"default"` // Default parser to use
	MinerU    *MineruConfig    `yaml:"mineru"`
	PaddleOCR *PaddleOCRConfig `yaml:"paddleocr"`
	GOTOCR    *GOTOCRConfig    `yaml:"got_ocr"`
	RAGFlow   *RAGFlowConfig   `yaml:"ragflow"`
}

// PaddleOCRConfig for PaddleOCR parser
type PaddleOCRConfig struct {
	Enabled                   bool   `yaml:"enabled"`
	APIURL                    string `yaml:"api_url"`
	APIToken                  string `yaml:"api_token"`
	UseDocOrientationClassify *bool  `yaml:"use_doc_orientation_classify"` // Optional: document orientation detection
	UseDocUnwarping           *bool  `yaml:"use_doc_unwarping"`            // Optional: document unwarping
	UseChartRecognition       *bool  `yaml:"use_chart_recognition"`        // Optional: chart recognition
	UseLayoutDetection        *bool  `yaml:"use_layout_detection"`         // Optional: layout detection, default true
	MergeTables               *bool  `yaml:"merge_tables"`                 // Optional: merge tables (VL feature)
	PrettifyMarkdown          *bool  `yaml:"prettify_markdown"`            // Optional: output prettified markdown
	PromptLabel               string `yaml:"prompt_label"`                 // Optional: prompt label for VL (e.g., 'ocr', 'formula', 'table')
	RestructurePages          *bool  `yaml:"restructure_pages"`            // Optional: restructure multi-page pdfs
	Visualize                 *bool  `yaml:"visualize"`                    // Optional: return images for visualization
}

// GOTOCRConfig for GOT-OCR parser
type GOTOCRConfig struct {
	Enabled     bool   `yaml:"enabled"`
	APIURL      string `yaml:"api_url"`
	APIToken    string `yaml:"api_token"`
	ModelType   string `yaml:"model_type"` // "base", "large"
	CallbackURL string `yaml:"callback_url"`
}

// RAGFlowConfig for RAGFlow parser
type RAGFlowConfig struct {
	Enabled     bool   `yaml:"enabled"`
	APIURL      string `yaml:"api_url"`
	APIToken    string `yaml:"api_token"`
	ChunkMethod string `yaml:"chunk_method"` // "naive", "qa", "table"
	CallbackURL string `yaml:"callback_url"`
}

// GotenbergConfig for DOCX to PDF conversion
type GotenbergConfig struct {
	Enabled           bool   `yaml:"enabled"`
	APIURL            string `yaml:"api_url"`             // e.g., "http://gotenberg:3000"
	BasicAuthUser     string `yaml:"basic_auth_user"`     // Optional: Basic Auth username
	BasicAuthPassword string `yaml:"basic_auth_password"` // Optional: Basic Auth password
	Timeout           int    `yaml:"timeout"`             // Conversion timeout in seconds
}

type AuthConfig struct {
	JWTSecret        string `yaml:"jwt_secret"`
	TokenExpireHours int    `yaml:"token_expire_hours"`
}

type User struct {
	Username string `yaml:"username"`
	Password string `yaml:"password"`
	Tenant   string `yaml:"tenant"`
}

type StoreConfig struct {
	MaxContracts  int `yaml:"max_contracts"`   // Maximum contracts to keep in memory, 0 = unlimited
	CacheTTLHours int `yaml:"cache_ttl_hours"` // Cache TTL in hours, default 24 (1 day)
}

// NotificationConfig contains settings for webhook notifications
type NotificationConfig struct {
	DingTalk           DingTalkConfig `yaml:"dingtalk"`
	Feishu             FeishuConfig   `yaml:"feishu"`
	CheckIntervalHours int            `yaml:"check_interval_hours"` // How often to check, default 12
}

// DingTalkConfig contains DingTalk webhook settings
type DingTalkConfig struct {
	WebhookURL string `yaml:"webhook_url"`
	Secret     string `yaml:"secret,omitempty"` // For signed webhooks
}

// FeishuConfig contains Feishu webhook settings
type FeishuConfig struct {
	WebhookURL string `yaml:"webhook_url"`
	Secret     string `yaml:"secret,omitempty"` // For signed webhooks
}

type TimingConfig struct {
	Enabled              bool `yaml:"enabled"`
	RequestThresholdMs   int  `yaml:"request_threshold_ms"`
	AsyncThresholdMs     int  `yaml:"async_threshold_ms"`
	EnableAlert          bool `yaml:"enable_alert"`
	AlertCooldownMinutes int  `yaml:"alert_cooldown_minutes"`
}

var GlobalConfig *Config

func ptrBool(b bool) *bool { return &b }

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	// Set defaults
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Minio.ExpireDays == 0 {
		cfg.Minio.ExpireDays = 7
	}
	if cfg.Auth.TokenExpireHours == 0 {
		cfg.Auth.TokenExpireHours = 24
	}

	// Parser defaults
	if cfg.Parsers.Default == "" {
		cfg.Parsers.Default = "mineru"
	}
	if cfg.Parsers.MinerU != nil {
		if cfg.Parsers.MinerU.ModelVersion == "" {
			cfg.Parsers.MinerU.ModelVersion = "vlm"
		}
		if cfg.Parsers.MinerU.TokenValidDays == 0 {
			cfg.Parsers.MinerU.TokenValidDays = 14
		}
	}

	if cfg.Parsers.PaddleOCR != nil {
		if cfg.Parsers.PaddleOCR.UseLayoutDetection == nil {
			cfg.Parsers.PaddleOCR.UseLayoutDetection = ptrBool(true) // 关闭 LayoutDetection 才能解锁 VL 模型对跨页表格的认知和段落感知
		}
		if cfg.Parsers.PaddleOCR.MergeTables == nil {
			cfg.Parsers.PaddleOCR.MergeTables = ptrBool(true) // 合同场景非常需要合并跨页表格
		}
		if cfg.Parsers.PaddleOCR.RestructurePages == nil {
			cfg.Parsers.PaddleOCR.RestructurePages = ptrBool(true) // 合同多页连贯性重构
		}
		if cfg.Parsers.PaddleOCR.PrettifyMarkdown == nil {
			cfg.Parsers.PaddleOCR.PrettifyMarkdown = ptrBool(true) // 美化带表格的文字混排
		}
		if cfg.Parsers.PaddleOCR.UseDocOrientationClassify == nil {
			cfg.Parsers.PaddleOCR.UseDocOrientationClassify = ptrBool(true) // 由于常遇到扫描件，默认开启方向纠正
		}
		if cfg.Parsers.PaddleOCR.UseDocUnwarping == nil {
			cfg.Parsers.PaddleOCR.UseDocUnwarping = ptrBool(true) // 由于常遇到扫描件，倾斜矫正开启
		}
	}
	if cfg.Gotenberg.Timeout == 0 {
		cfg.Gotenberg.Timeout = 60
	}

	if cfg.Log.Level == "" {
		cfg.Log.Level = "info"
	}
	if cfg.Log.Format == "" {
		cfg.Log.Format = "text"
	}
	if cfg.Notification.CheckIntervalHours == 0 {
		cfg.Notification.CheckIntervalHours = 12
	}
	if cfg.Store.CacheTTLHours == 0 {
		cfg.Store.CacheTTLHours = 24
	}

	if cfg.Timing.RequestThresholdMs == 0 {
		cfg.Timing.RequestThresholdMs = 2000
	}
	if cfg.Timing.AsyncThresholdMs == 0 {
		cfg.Timing.AsyncThresholdMs = 15000
	}
	if cfg.Timing.AlertCooldownMinutes == 0 {
		cfg.Timing.AlertCooldownMinutes = 5
	}

	GlobalConfig = &cfg
	return &cfg, nil
}

// FindUser finds a user by username
func (c *Config) FindUser(username string) *User {
	for i := range c.Users {
		if c.Users[i].Username == username {
			return &c.Users[i]
		}
	}
	return nil
}
