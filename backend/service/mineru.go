package service

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
)

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
	Code    int    `json:"code"`
	Message string `json:"msg"`
	Data    struct {
		TaskID string `json:"task_id"`
	} `json:"data"`
}

// MineruTaskStatusResponse represents the task status query response
type MineruTaskStatusResponse struct {
	Code    int    `json:"code"`
	Message string `json:"msg"`
	TraceID string `json:"trace_id"`
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

	var result MineruTaskResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w, body: %s", err, string(body))
	}

	if result.Code != 0 {
		return nil, fmt.Errorf("MinerU API error: %s", result.Message)
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

	// Log raw response for debugging
	fmt.Printf("[MinerU] Raw status response: %s\n", string(body))

	var result MineruTaskStatusResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if result.Code != 0 {
		return nil, fmt.Errorf("MinerU API error: %s", result.Message)
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
	fmt.Printf("[MinerU] Downloading ZIP from: %s\n", zipURL)

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

	fmt.Printf("[MinerU] ZIP downloaded, size: %d bytes\n", len(zipData))

	// Open the ZIP archive
	zipReader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, fmt.Errorf("failed to open ZIP: %w", err)
	}

	// Look for JSON files in the ZIP
	var jsonData map[string]interface{}
	jsonFiles := []string{"content_list.json", "middle.json", "model.json"}

	for _, file := range zipReader.File {
		fmt.Printf("[MinerU] ZIP contains file: %s\n", file.Name)

		// Check if this is one of the JSON files we're looking for
		for _, targetFile := range jsonFiles {
			if strings.HasSuffix(file.Name, targetFile) {
				fmt.Printf("[MinerU] Found target JSON: %s\n", file.Name)

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
					fmt.Printf("[MinerU] Failed to parse %s: %v\n", file.Name, err)
					continue
				}

				fmt.Printf("[MinerU] Successfully parsed JSON from %s\n", file.Name)
				return jsonData, nil
			}
		}
	}

	// If no specific JSON found, try any .json file
	for _, file := range zipReader.File {
		if strings.HasSuffix(file.Name, ".json") {
			fmt.Printf("[MinerU] Trying fallback JSON: %s\n", file.Name)

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
