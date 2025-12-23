package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server ServerConfig `yaml:"server"`
	Minio  MinioConfig  `yaml:"minio"`
	Mineru MineruConfig `yaml:"mineru"`
	Auth   AuthConfig   `yaml:"auth"`
	Log    LogConfig    `yaml:"log"`
	Store  StoreConfig  `yaml:"store"`
	Users  []User       `yaml:"users"`
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
	APIURL       string `yaml:"api_url"`
	APIToken     string `yaml:"api_token"`
	ModelVersion string `yaml:"model_version"`
	CallbackURL  string `yaml:"callback_url"`
	Seed         string `yaml:"seed"`
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
	MaxContracts int `yaml:"max_contracts"` // Maximum contracts to keep in memory, 0 = unlimited
}

var GlobalConfig *Config

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
	if cfg.Mineru.ModelVersion == "" {
		cfg.Mineru.ModelVersion = "vlm"
	}
	if cfg.Log.Level == "" {
		cfg.Log.Level = "info"
	}
	if cfg.Log.Format == "" {
		cfg.Log.Format = "text"
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
