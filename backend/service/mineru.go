package service

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
)

// MinerU API error codes
const (
	MineruErrorTokenInvalid = "A0202" // Token 错误
	MineruErrorTokenExpired = "A0211" // Token 过期
	MineruErrorParamInvalid = -500    // 传参错误
	MineruErrorServiceError = -10001  // 服务异常
	MineruErrorRequestParam = -10002  // 请求参数错误
	MineruErrorTaskNotFound = -60012  // 找不到任务
	MineruErrorNoPermission = -60013  // 没有权限访问该任务
	MineruErrorDailyLimit   = -60018  // 每日解析任务数量已达上限
)

// MineruAPIError represents a structured error from MinerU API
type MineruAPIError struct {
	Code        interface{} // Can be string (A0202, A0211) or int (-500, -60012, etc.)
	Message     string
	IsAuthError bool // True if error is related to authentication/token
}

func (e *MineruAPIError) Error() string {
	return fmt.Sprintf("MinerU API error [%v]: %s", e.Code, e.Message)
}

// IsMineruAuthError checks if an error is a MinerU authentication error
func IsMineruAuthError(err error) bool {
	if mineruErr, ok := err.(*MineruAPIError); ok {
		return mineruErr.IsAuthError
	}
	return false
}

// GetMineruErrorMessage returns a user-friendly error message
func GetMineruErrorMessage(err error) string {
	if mineruErr, ok := err.(*MineruAPIError); ok {
		switch mineruErr.Code {
		case MineruErrorTokenInvalid:
			return "解析工具 Token 错误，请检查配置"
		case MineruErrorTokenExpired:
			return "解析工具 Token 已过期，请更新 Token"
		case MineruErrorDailyLimit:
			return "解析工具每日解析配额已用完，请明日再试"
		case MineruErrorTaskNotFound:
			return "解析任务不存在或已被删除"
		case MineruErrorNoPermission:
			return "没有权限访问该解析任务"
		default:
			// Check if it's an auth error by message
			if mineruErr.IsAuthError {
				return "解析工具认证失败，请检查 Token 是否有效或已过期"
			}
			return mineruErr.Message
		}
	}
	return err.Error()
}

// parseMineruError creates a structured error from API response
func parseMineruError(code interface{}, message string) *MineruAPIError {
	err := &MineruAPIError{
		Code:    code,
		Message: message,
	}

	// Check for auth errors by code
	switch code {
	case MineruErrorTokenInvalid, MineruErrorTokenExpired:
		err.IsAuthError = true
	}

	// Also check for auth errors by message content
	msgLower := strings.ToLower(message)
	if strings.Contains(msgLower, "authenticate") ||
	   strings.Contains(msgLower, "token") ||
	   strings.Contains(msgLower, "unauthorized") ||
	   strings.Contains(msgLower, "forbidden") {
		err.IsAuthError = true
	}

	return err
}

type MineruService struct {
	config     *config.MineruConfig
	httpClient *http.Client
}

// MineruTaskRequest represents the request to create an extraction task
type MineruTaskRequest struct {
	URL          string `json:"url"`
	ModelVersion string `json:"model_version"`
	Callback     string `json:"callback,omitempty"`
	Seed         string `json:"seed,omitempty"`
	DataID       string `json:"data_id,omitempty"`
}

// MineruTaskResponse represents the response from task creation
type MineruTaskResponse struct {
	Code    json.RawMessage `json:"code"` // Can be int (0) or string ("A0202")
	Message string          `json:"msg"`
	Data    struct {
		TaskID string `json:"task_id"`
	} `json:"data"`
}

// MineruTaskStatusResponse represents the task status query response
type MineruTaskStatusResponse struct {
	Code    json.RawMessage `json:"code"` // Can be int (0) or string ("A0202")
	Message string          `json:"msg"`
	TraceID string          `json:"trace_id"`
	Data    struct {
		TaskID          string `json:"task_id"`
		DataID          string `json:"data_id"`
		State           string `json:"state"` // pending, running, done, failed, converting
		FullZipURL      string `json:"full_zip_url,omitempty"`
		ErrorMsg        string `json:"err_msg,omitempty"`
		ModelVersion    string `json:"model_version,omitempty"`
		ExtractProgress struct {
			ExtractedPages int    `json:"extracted_pages"`
			TotalPages     int    `json:"total_pages"`
			StartTime      string `json:"start_time"`
		} `json:"extract_progress,omitempty"`
	} `json:"data"`
}

// parseCodeValue extracts the code value from json.RawMessage
func parseCodeValue(raw json.RawMessage) interface{} {
	// Try as int first
	var intCode int
	if err := json.Unmarshal(raw, &intCode); err == nil {
		return intCode
	}
	// Try as string
	var strCode string
	if err := json.Unmarshal(raw, &strCode); err == nil {
		return strCode
	}
	return string(raw)
}

// isSuccessCode checks if the code indicates success (0)
func isSuccessCode(raw json.RawMessage) bool {
	var intCode int
	if err := json.Unmarshal(raw, &intCode); err == nil {
		return intCode == 0
	}
	return false
}

// MineruCallbackPayload represents the callback payload from MinerU
type MineruCallbackPayload struct {
	Checksum string `json:"checksum"`
	Content  string `json:"content"`
}

func NewMineruService(cfg *config.MineruConfig) *MineruService {
	return &MineruService{
		config: cfg,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// CreateTask creates a new extraction task
func (s *MineruService) CreateTask(pdfURL, dataID string) (*MineruTaskResponse, error) {
	reqBody := MineruTaskRequest{
		URL:          pdfURL,
		ModelVersion: s.config.ModelVersion,
		DataID:       dataID,
	}

	if s.config.CallbackURL != "" {
		reqBody.Callback = s.config.CallbackURL
		reqBody.Seed = s.config.Seed
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", s.config.APIURL+"/extract/task", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+s.config.APIToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "*/*")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Log response for debugging
	slog.Info("MinerU create task response",
		"status_code", resp.StatusCode,
		"body", string(body),
	)

	var result MineruTaskResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w, body: %s", err, string(body))
	}

	if !isSuccessCode(result.Code) {
		return nil, parseMineruError(parseCodeValue(result.Code), result.Message)
	}

	return &result, nil
}

// GetTaskStatus queries the status of a task
func (s *MineruService) GetTaskStatus(taskID string) (*MineruTaskStatusResponse, error) {
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/extract/task/%s", s.config.APIURL, taskID), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+s.config.APIToken)
	req.Header.Set("Accept", "*/*")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Log raw response for debugging at debug level
	slog.Debug("MinerU status response",
		"task_id", taskID,
		"body", string(body),
	)

	var result MineruTaskStatusResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if !isSuccessCode(result.Code) {
		return nil, parseMineruError(parseCodeValue(result.Code), result.Message)
	}

	return &result, nil
}

// VerifyCallback verifies the callback checksum
func (s *MineruService) VerifyCallback(checksum, content string, uid string) bool {
	// Checksum = SHA256(uid + seed + content)
	data := uid + s.config.Seed + content
	hash := sha256.Sum256([]byte(data))
	expected := hex.EncodeToString(hash[:])
	return checksum == expected
}

// FetchJSONResult fetches the JSON result from a direct URL (legacy)
func (s *MineruService) FetchJSONResult(jsonURL string) (map[string]interface{}, error) {
	resp, err := s.httpClient.Get(jsonURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch JSON: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read JSON: %w", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %w", err)
	}

	return result, nil
}

// FetchZipAndExtractJSON downloads the ZIP file and extracts the JSON content
func (s *MineruService) FetchZipAndExtractJSON(zipURL string) (map[string]interface{}, error) {
	slog.Debug("downloading ZIP", "url", zipURL)

	resp, err := s.httpClient.Get(zipURL)
	if err != nil {
		return nil, fmt.Errorf("failed to download ZIP: %w", err)
	}
	defer resp.Body.Close()

	// Read the entire ZIP into memory
	zipData, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read ZIP: %w", err)
	}

	slog.Debug("ZIP downloaded", "size_bytes", len(zipData))

	// Open the ZIP archive
	zipReader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, fmt.Errorf("failed to open ZIP: %w", err)
	}

	// Look for JSON files in the ZIP
	var jsonData map[string]interface{}
	jsonFiles := []string{"content_list.json", "middle.json", "model.json"}

	for _, file := range zipReader.File {
		slog.Debug("ZIP file entry", "name", file.Name)

		// Check if this is one of the JSON files we're looking for
		for _, targetFile := range jsonFiles {
			if strings.HasSuffix(file.Name, targetFile) {
				slog.Debug("found target JSON", "file", file.Name)

				rc, err := file.Open()
				if err != nil {
					continue
				}

				content, err := io.ReadAll(rc)
				rc.Close()
				if err != nil {
					continue
				}

				if err := json.Unmarshal(content, &jsonData); err != nil {
					slog.Debug("failed to parse JSON file", "file", file.Name, "error", err)
					continue
				}

				slog.Info("successfully parsed JSON", "file", file.Name)
				return jsonData, nil
			}
		}
	}

	// If no specific JSON found, try any .json file
	for _, file := range zipReader.File {
		if strings.HasSuffix(file.Name, ".json") {
			slog.Debug("trying fallback JSON", "file", file.Name)

			rc, err := file.Open()
			if err != nil {
				continue
			}

			content, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				continue
			}

			if err := json.Unmarshal(content, &jsonData); err != nil {
				continue
			}

			return jsonData, nil
		}
	}

	return nil, fmt.Errorf("no valid JSON file found in ZIP")
}
