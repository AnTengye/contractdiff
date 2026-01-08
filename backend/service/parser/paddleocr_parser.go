package parser

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
)

// PaddleOCRParser implements DocumentParser for PaddleOCR API
type PaddleOCRParser struct {
	config     *config.PaddleOCRConfig
	httpClient *http.Client
}

// NewPaddleOCRParser creates a new PaddleOCR parser instance
func NewPaddleOCRParser(cfg *config.PaddleOCRConfig) (*PaddleOCRParser, error) {
	if cfg == nil || !cfg.Enabled {
		return nil, fmt.Errorf("PaddleOCR parser not enabled")
	}

	return &PaddleOCRParser{
		config: cfg,
		httpClient: &http.Client{
			Timeout: 300 * time.Second, // Increased timeout for large files
		},
	}, nil
}

// GetCapabilities returns the capabilities of PaddleOCR parser
func (p *PaddleOCRParser) GetCapabilities() ParserCapabilities {
	return ParserCapabilities{
		Name:             "PaddleOCR",
		Type:             ParserTypePaddleOCR,
		SupportedFormats: []string{"pdf"}, // Only PDF, not DOCX
		MaxFileSize:      20 * 1024 * 1024, // 20MB
		Features:         []string{"ocr", "text_detection", "text_recognition", "multi_language"},
		Description:      "百度 PaddleOCR 文本识别，支持中英文混合识别",
	}
}

// CanParse checks if PaddleOCR can handle the given format
func (p *PaddleOCRParser) CanParse(format string) bool {
	return format == "pdf" // Only supports PDF
}

// CreateTask creates a new OCR task in PaddleOCR
// Note: PaddleOCR is synchronous - it returns results immediately
// This method downloads the file, encodes it to base64, and processes it
func (p *PaddleOCRParser) CreateTask(ctx context.Context, fileURL, documentID string) (string, error) {
	startTime := time.Now()

	// Download the file from the presigned URL with context
	req, err := http.NewRequestWithContext(ctx, "GET", fileURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create download request: %w", err)
	}

	fileResp, err := p.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to download file: %w", err)
	}
	defer fileResp.Body.Close()

	if fileResp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download file, status: %d", fileResp.StatusCode)
	}

	// Read file content with size limit to prevent memory issues
	const maxFileSize = 50 * 1024 * 1024 // 50MB limit
	limitedReader := io.LimitReader(fileResp.Body, maxFileSize)
	fileBytes, err := io.ReadAll(limitedReader)
	if err != nil {
		return "", fmt.Errorf("failed to read file content: %w", err)
	}

	// Check if file was truncated
	if len(fileBytes) >= maxFileSize {
		return "", fmt.Errorf("file exceeds maximum size of 50MB")
	}

	slog.Debug("file downloaded for PaddleOCR processing",
		"document_id", documentID,
		"file_size_bytes", len(fileBytes),
		"download_duration_ms", time.Since(startTime).Milliseconds())

	// Encode to base64
	encodeStart := time.Now()
	fileData := base64.StdEncoding.EncodeToString(fileBytes)
	slog.Debug("base64 encoding completed",
		"document_id", documentID,
		"encoding_duration_ms", time.Since(encodeStart).Milliseconds())

	// Build request payload - only include optional params if true to reduce payload size
	reqBody := map[string]interface{}{
		"file":     fileData,
		"fileType": 0, // 0 for PDF, 1 for images
	}

	// Only add optional parameters if enabled (saves payload size)
	if p.config.UseDocOrientationClassify {
		reqBody["useDocOrientationClassify"] = true
	}
	if p.config.UseDocUnwarping {
		reqBody["useDocUnwarping"] = true
	}
	if p.config.UseChartRecognition {
		reqBody["useChartRecognition"] = true
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	slog.Debug("sending request to PaddleOCR API",
		"document_id", documentID,
		"payload_size_bytes", len(jsonData))

	// Create request with context for proper cancellation
	apiReq, err := http.NewRequestWithContext(ctx, "POST", p.config.APIURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	// Use "token {TOKEN}" format for authorization
	apiReq.Header.Set("Authorization", "token "+p.config.APIToken)
	apiReq.Header.Set("Content-Type", "application/json")

	apiStart := time.Now()
	resp, err := p.httpClient.Do(apiReq)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("PaddleOCR API returned status %d: %s", resp.StatusCode, string(body))
	}

	// Read response body
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	slog.Info("PaddleOCR processing completed",
		"document_id", documentID,
		"api_duration_ms", time.Since(apiStart).Milliseconds(),
		"total_duration_ms", time.Since(startTime).Milliseconds(),
		"response_size_bytes", len(respBody))

	// PaddleOCR returns results synchronously
	// We'll use documentID as the "taskID" to maintain compatibility with the async interface
	// Store the result in memory for later retrieval
	p.storeResult(documentID, respBody)

	return documentID, nil
}

// resultStore holds processed results temporarily (in-memory cache with TTL)
type resultCache struct {
	mu      sync.RWMutex
	results map[string]*cacheEntry
}

type cacheEntry struct {
	data      []byte
	timestamp time.Time
}

var (
	resultStore  = &resultCache{results: make(map[string]*cacheEntry)}
	cacheTTL     = 1 * time.Hour // Results expire after 1 hour
	cleanupOnce  sync.Once
)

func (p *PaddleOCRParser) storeResult(taskID string, data []byte) {
	// Start cleanup goroutine on first use
	cleanupOnce.Do(func() {
		go cleanupExpiredResults()
	})

	resultStore.mu.Lock()
	defer resultStore.mu.Unlock()
	resultStore.results[taskID] = &cacheEntry{
		data:      data,
		timestamp: time.Now(),
	}

	slog.Debug("result cached", "task_id", taskID, "size_bytes", len(data))
}

func (p *PaddleOCRParser) getStoredResult(taskID string) ([]byte, bool) {
	resultStore.mu.RLock()
	defer resultStore.mu.RUnlock()

	entry, ok := resultStore.results[taskID]
	if !ok {
		return nil, false
	}

	// Check if expired
	if time.Since(entry.timestamp) > cacheTTL {
		return nil, false
	}

	return entry.data, true
}

// cleanupExpiredResults periodically removes expired cache entries
func cleanupExpiredResults() {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		resultStore.mu.Lock()
		now := time.Now()
		expiredCount := 0

		for taskID, entry := range resultStore.results {
			if now.Sub(entry.timestamp) > cacheTTL {
				delete(resultStore.results, taskID)
				expiredCount++
			}
		}

		resultStore.mu.Unlock()

		if expiredCount > 0 {
			slog.Info("cleaned up expired PaddleOCR results",
				"expired_count", expiredCount,
				"remaining_count", len(resultStore.results))
		}
	}
}

// GetTaskStatus retrieves the status of a PaddleOCR task
// Since PaddleOCR is synchronous, this always returns "completed" if result exists
func (p *PaddleOCRParser) GetTaskStatus(ctx context.Context, taskID string) (*TaskStatus, error) {
	// Check if result exists in our store
	if _, ok := p.getStoredResult(taskID); ok {
		return &TaskStatus{
			State:        "completed",
			ResultURL:    "",
			ErrorMessage: "",
		}, nil
	}

	// If not found, task doesn't exist or failed
	return &TaskStatus{
		State:        "failed",
		ErrorMessage: "Task result not found",
	}, nil
}

// FetchResult retrieves the stored result from PaddleOCR
func (p *PaddleOCRParser) FetchResult(ctx context.Context, taskID string, resultURL string) (map[string]interface{}, error) {
	// Get result from in-memory store
	data, ok := p.getStoredResult(taskID)
	if !ok {
		return nil, fmt.Errorf("result not found for task %s", taskID)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal result JSON: %w", err)
	}

	return result, nil
}

// NormalizeResult converts PaddleOCR output to standard format
// PaddleOCR returns: {result: {layoutParsingResults: [{markdown: {text, images}, outputImages}]}}
func (p *PaddleOCRParser) NormalizeResult(rawData map[string]interface{}) (map[string]interface{}, error) {
	normalized := map[string]interface{}{
		"paragraphs": normalizePaddleOCRParagraphs(rawData),
		"tables":     []interface{}{}, // PaddleOCR doesn't detect table structure separately
		"images":     extractPaddleOCRImages(rawData),
		"metadata": map[string]interface{}{
			"source": "paddleocr",
		},
	}

	return normalized, nil
}

// extractPaddleOCRImages extracts images from PaddleOCR result
func extractPaddleOCRImages(data map[string]interface{}) []interface{} {
	images := []interface{}{}

	if result, ok := data["result"].(map[string]interface{}); ok {
		if layoutResults, ok := result["layoutParsingResults"].([]interface{}); ok {
			for _, layoutData := range layoutResults {
				if layout, ok := layoutData.(map[string]interface{}); ok {
					// Extract images from markdown
					if markdown, ok := layout["markdown"].(map[string]interface{}); ok {
						if mdImages, ok := markdown["images"].(map[string]interface{}); ok {
							for imgPath, imgURL := range mdImages {
								if url, ok := imgURL.(string); ok {
									images = append(images, map[string]interface{}{
										"path": imgPath,
										"url":  url,
									})
								}
							}
						}
					}
					// Extract output images
					if outputImages, ok := layout["outputImages"].(map[string]interface{}); ok {
						for imgName, imgURL := range outputImages {
							if url, ok := imgURL.(string); ok {
								images = append(images, map[string]interface{}{
									"name": imgName,
									"url":  url,
								})
							}
						}
					}
				}
			}
		}
	}

	return images
}

// normalizePaddleOCRParagraphs converts PaddleOCR text to standard paragraph format
func normalizePaddleOCRParagraphs(data map[string]interface{}) []interface{} {
	paragraphs := []interface{}{}

	// Extract markdown text from layoutParsingResults
	if result, ok := data["result"].(map[string]interface{}); ok {
		if layoutResults, ok := result["layoutParsingResults"].([]interface{}); ok {
			for pageIdx, layoutData := range layoutResults {
				if layout, ok := layoutData.(map[string]interface{}); ok {
					if markdown, ok := layout["markdown"].(map[string]interface{}); ok {
						if text, ok := markdown["text"].(string); ok {
							// Each page's markdown is treated as paragraphs
							paragraph := map[string]interface{}{
								"page":  pageIdx + 1,
								"index": 0,
								"type":  "text",
								"text":  text,
							}
							paragraphs = append(paragraphs, paragraph)
						}
					}
				}
			}
		}
	}

	return paragraphs
}
