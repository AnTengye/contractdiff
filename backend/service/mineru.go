package service

import (
	"archive/zip"
	"bytes"
	"context"
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
	"github.com/AnTengye/contractdiff/backend/pkg/httpclient"
)

const (
	MineruErrorTokenInvalid = "A0202"
	MineruErrorTokenExpired = "A0211"
	MineruErrorParamInvalid = -500
	MineruErrorServiceError = -10001
	MineruErrorRequestParam = -10002
	MineruErrorTaskNotFound = -60012
	MineruErrorNoPermission = -60013
	MineruErrorDailyLimit   = -60018
)

type MineruAPIError struct {
	Code        interface{}
	Message     string
	IsAuthError bool
}

func (e *MineruAPIError) Error() string {
	return fmt.Sprintf("MinerU API error [%v]: %s", e.Code, e.Message)
}

func IsMineruAuthError(err error) bool {
	if mineruErr, ok := err.(*MineruAPIError); ok {
		return mineruErr.IsAuthError
	}
	return false
}

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
			if mineruErr.IsAuthError {
				return "解析工具 Token 已过期，请更新 Token"
			}
			return mineruErr.Message
		}
	}
	return err.Error()
}

func ParseMineruError(code interface{}, message string) *MineruAPIError {
	err := &MineruAPIError{
		Code:    code,
		Message: message,
	}

	switch code {
	case MineruErrorTokenInvalid, MineruErrorTokenExpired:
		err.IsAuthError = true
	}

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
	httpClient *httpclient.Client
}

type MineruTaskRequest struct {
	URL          string `json:"url"`
	ModelVersion string `json:"model_version"`
	Callback     string `json:"callback,omitempty"`
	Seed         string `json:"seed,omitempty"`
	DataID       string `json:"data_id,omitempty"`
}

type MineruTaskResponse struct {
	Code    json.RawMessage `json:"code"`
	Message string          `json:"msg"`
	Data    struct {
		TaskID string `json:"task_id"`
	} `json:"data"`
}

type MineruTaskStatusResponse struct {
	Code    json.RawMessage `json:"code"`
	Message string          `json:"msg"`
	TraceID string          `json:"trace_id"`
	Data    struct {
		TaskID          string `json:"task_id"`
		DataID          string `json:"data_id"`
		State           string `json:"state"`
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

func parseCodeValue(raw json.RawMessage) interface{} {
	var intCode int
	if err := json.Unmarshal(raw, &intCode); err == nil {
		return intCode
	}
	var strCode string
	if err := json.Unmarshal(raw, &strCode); err == nil {
		return strCode
	}
	return string(raw)
}

func isSuccessCode(raw json.RawMessage) bool {
	var intCode int
	if err := json.Unmarshal(raw, &intCode); err == nil {
		return intCode == 0
	}
	return false
}

type MineruCallbackPayload struct {
	Checksum string `json:"checksum"`
	Content  string `json:"content"`
}

func NewMineruService(cfg *config.MineruConfig) *MineruService {
	return &MineruService{
		config:     cfg,
		httpClient: httpclient.NewWithTimeout(60 * time.Second),
	}
}

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

	ctx := context.Background()
	resp, err := s.httpClient.R(ctx).
		SetHeader("Authorization", "Bearer "+s.config.APIToken).
		SetHeader("Content-Type", "application/json").
		SetHeader("Accept", "*/*").
		SetBody(reqBody).
		Post(s.config.APIURL + "/extract/task")
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}

	slog.Info("MinerU create task response",
		"status_code", resp.StatusCode(),
		"body", string(resp.Body()),
	)

	var result MineruTaskResponse
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w, body: %s", err, string(resp.Body()))
	}

	if !isSuccessCode(result.Code) {
		return nil, ParseMineruError(parseCodeValue(result.Code), result.Message)
	}

	return &result, nil
}

func (s *MineruService) GetTaskStatus(taskID string) (*MineruTaskStatusResponse, error) {
	ctx := context.Background()
	resp, err := s.httpClient.R(ctx).
		SetHeader("Authorization", "Bearer "+s.config.APIToken).
		SetHeader("Accept", "*/*").
		Get(fmt.Sprintf("%s/extract/task/%s", s.config.APIURL, taskID))
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}

	slog.Debug("MinerU status response",
		"task_id", taskID,
		"body", string(resp.Body()),
	)

	var result MineruTaskStatusResponse
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if !isSuccessCode(result.Code) {
		return nil, ParseMineruError(parseCodeValue(result.Code), result.Message)
	}

	return &result, nil
}

func (s *MineruService) VerifyCallback(checksum, content string, uid string) bool {
	data := uid + s.config.Seed + content
	hash := sha256.Sum256([]byte(data))
	expected := hex.EncodeToString(hash[:])
	return checksum == expected
}

func (s *MineruService) FetchJSONResult(jsonURL string) (map[string]interface{}, error) {
	ctx := context.Background()
	resp, err := s.httpClient.Get(ctx, jsonURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch JSON: %w", err)
	}

	if resp.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch JSON, status: %d", resp.StatusCode())
	}

	var result map[string]interface{}
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %w", err)
	}

	return result, nil
}

func (s *MineruService) FetchZipAndExtractJSON(zipURL string) (map[string]interface{}, error) {
	slog.Debug("downloading ZIP", "url", zipURL)

	ctx := context.Background()
	resp, err := s.httpClient.Get(ctx, zipURL)
	if err != nil {
		return nil, fmt.Errorf("failed to download ZIP: %w", err)
	}

	if resp.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("failed to download ZIP, status: %d", resp.StatusCode())
	}

	zipData := resp.Body()
	slog.Debug("ZIP downloaded", "size_bytes", len(zipData))

	zipReader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, fmt.Errorf("failed to open ZIP: %w", err)
	}

	var jsonData map[string]interface{}
	jsonFiles := []string{"content_list.json", "middle.json", "model.json"}

	for _, file := range zipReader.File {
		slog.Debug("ZIP file entry", "name", file.Name)

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

type ZipExtractResult struct {
	JSONData map[string]interface{}
	PDFData  []byte
	PDFName  string
}

func (s *MineruService) FetchZipAndExtractFiles(zipURL string) (*ZipExtractResult, error) {
	slog.Debug("downloading ZIP for full extraction", "url", zipURL)

	ctx := context.Background()
	resp, err := s.httpClient.Get(ctx, zipURL)
	if err != nil {
		return nil, fmt.Errorf("failed to download ZIP: %w", err)
	}

	if resp.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("failed to download ZIP, status: %d", resp.StatusCode())
	}

	zipData := resp.Body()
	slog.Debug("ZIP downloaded", "size_bytes", len(zipData))

	zipReader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, fmt.Errorf("failed to open ZIP: %w", err)
	}

	result := &ZipExtractResult{}

	jsonFiles := []string{"content_list.json", "middle.json", "model.json"}
	pdfFiles := []string{"layout.pdf", "spans.pdf", "origin.pdf"}

	for _, file := range zipReader.File {
		slog.Debug("ZIP file entry", "name", file.Name)

		if result.JSONData == nil {
			for _, targetFile := range jsonFiles {
				if strings.HasSuffix(file.Name, targetFile) {
					rc, err := file.Open()
					if err != nil {
						continue
					}
					content, err := io.ReadAll(rc)
					rc.Close()
					if err != nil {
						continue
					}
					if err := json.Unmarshal(content, &result.JSONData); err != nil {
						slog.Debug("failed to parse JSON file", "file", file.Name, "error", err)
						continue
					}
					slog.Info("extracted JSON", "file", file.Name)
					break
				}
			}
		}

		if result.PDFData == nil {
			for _, targetFile := range pdfFiles {
				if strings.HasSuffix(file.Name, targetFile) {
					rc, err := file.Open()
					if err != nil {
						continue
					}
					content, err := io.ReadAll(rc)
					rc.Close()
					if err != nil {
						continue
					}
					if len(content) > 4 && string(content[:4]) == "%PDF" {
						result.PDFData = content
						result.PDFName = targetFile
						slog.Info("extracted PDF", "file", file.Name, "size", len(content))
						break
					}
				}
			}
		}

		if result.JSONData != nil && result.PDFData != nil {
			break
		}
	}

	if result.JSONData == nil {
		for _, file := range zipReader.File {
			if strings.HasSuffix(file.Name, ".json") {
				rc, err := file.Open()
				if err != nil {
					continue
				}
				content, err := io.ReadAll(rc)
				rc.Close()
				if err != nil {
					continue
				}
				if err := json.Unmarshal(content, &result.JSONData); err != nil {
					continue
				}
				slog.Info("extracted fallback JSON", "file", file.Name)
				break
			}
		}
	}

	if result.PDFData == nil {
		for _, file := range zipReader.File {
			if strings.HasSuffix(file.Name, ".pdf") {
				rc, err := file.Open()
				if err != nil {
					continue
				}
				content, err := io.ReadAll(rc)
				rc.Close()
				if err != nil {
					continue
				}
				if len(content) > 4 && string(content[:4]) == "%PDF" {
					result.PDFData = content
					result.PDFName = file.Name
					slog.Info("extracted fallback PDF", "file", file.Name, "size", len(content))
					break
				}
			}
		}
	}

	if result.JSONData == nil {
		return nil, fmt.Errorf("no valid JSON file found in ZIP")
	}

	return result, nil
}
