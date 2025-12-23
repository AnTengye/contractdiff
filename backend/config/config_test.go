package config

import (
	"os"
	"testing"
)

func TestLoad(t *testing.T) {
	// Create a temporary config file
	configContent := `
server:
  port: 9090
minio:
  endpoint: "localhost:9000"
  access_key: "minioadmin"
  secret_key: "minioadmin"
  bucket: "test-bucket"
  use_ssl: false
  expire_days: 14
mineru:
  api_url: "https://api.mineru.test"
  api_token: "test-token"
  model_version: "vlm"
auth:
  jwt_secret: "test-secret"
  token_expire_hours: 48
log:
  level: "debug"
  format: "json"
store:
  max_contracts: 50
users:
  - username: "testuser"
    password: "testpass"
    tenant: "testtenant"
`
	tmpFile, err := os.CreateTemp("", "config-*.yaml")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(configContent); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}
	tmpFile.Close()

	// Test loading config
	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// Verify values
	if cfg.Server.Port != 9090 {
		t.Errorf("Expected port 9090, got %d", cfg.Server.Port)
	}
	if cfg.Minio.Endpoint != "localhost:9000" {
		t.Errorf("Expected endpoint localhost:9000, got %s", cfg.Minio.Endpoint)
	}
	if cfg.Minio.ExpireDays != 14 {
		t.Errorf("Expected expire_days 14, got %d", cfg.Minio.ExpireDays)
	}
	if cfg.Auth.TokenExpireHours != 48 {
		t.Errorf("Expected token_expire_hours 48, got %d", cfg.Auth.TokenExpireHours)
	}
	if cfg.Log.Level != "debug" {
		t.Errorf("Expected log level debug, got %s", cfg.Log.Level)
	}
	if cfg.Log.Format != "json" {
		t.Errorf("Expected log format json, got %s", cfg.Log.Format)
	}
	if cfg.Store.MaxContracts != 50 {
		t.Errorf("Expected max_contracts 50, got %d", cfg.Store.MaxContracts)
	}
	if len(cfg.Users) != 1 {
		t.Errorf("Expected 1 user, got %d", len(cfg.Users))
	}
	if cfg.Users[0].Username != "testuser" {
		t.Errorf("Expected username testuser, got %s", cfg.Users[0].Username)
	}
}

func TestLoadDefaults(t *testing.T) {
	// Create minimal config to test defaults
	configContent := `
minio:
  endpoint: "localhost:9000"
  access_key: "test"
  secret_key: "test"
  bucket: "bucket"
`
	tmpFile, err := os.CreateTemp("", "config-defaults-*.yaml")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(configContent); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}
	tmpFile.Close()

	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// Verify defaults
	if cfg.Server.Port != 8080 {
		t.Errorf("Expected default port 8080, got %d", cfg.Server.Port)
	}
	if cfg.Minio.ExpireDays != 7 {
		t.Errorf("Expected default expire_days 7, got %d", cfg.Minio.ExpireDays)
	}
	if cfg.Auth.TokenExpireHours != 24 {
		t.Errorf("Expected default token_expire_hours 24, got %d", cfg.Auth.TokenExpireHours)
	}
	if cfg.Mineru.ModelVersion != "vlm" {
		t.Errorf("Expected default model_version vlm, got %s", cfg.Mineru.ModelVersion)
	}
	if cfg.Log.Level != "info" {
		t.Errorf("Expected default log level info, got %s", cfg.Log.Level)
	}
	if cfg.Log.Format != "text" {
		t.Errorf("Expected default log format text, got %s", cfg.Log.Format)
	}
}

func TestLoadNonExistent(t *testing.T) {
	_, err := Load("nonexistent.yaml")
	if err == nil {
		t.Error("Expected error for non-existent file")
	}
}

func TestLoadInvalidYAML(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "config-invalid-*.yaml")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString("invalid: yaml: content:"); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}
	tmpFile.Close()

	_, err = Load(tmpFile.Name())
	if err == nil {
		t.Error("Expected error for invalid YAML")
	}
}

func TestFindUser(t *testing.T) {
	cfg := &Config{
		Users: []User{
			{Username: "user1", Password: "pass1", Tenant: "tenant1"},
			{Username: "user2", Password: "pass2", Tenant: "tenant2"},
		},
	}

	// Test finding existing user
	user := cfg.FindUser("user1")
	if user == nil {
		t.Error("Expected to find user1")
	}
	if user.Password != "pass1" {
		t.Errorf("Expected password pass1, got %s", user.Password)
	}

	// Test finding non-existent user
	user = cfg.FindUser("nonexistent")
	if user != nil {
		t.Error("Expected nil for non-existent user")
	}
}
