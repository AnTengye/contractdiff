package parser

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/pkg/httpclient"
)

type PaddleOCRParser struct {
	config     *config.PaddleOCRConfig
	httpClient *httpclient.Client
}

func NewPaddleOCRParser(cfg *config.PaddleOCRConfig) (*PaddleOCRParser, error) {
	if cfg == nil || !cfg.Enabled {
		return nil, fmt.Errorf("PaddleOCR parser not enabled")
	}

	return &PaddleOCRParser{
		config:     cfg,
		httpClient: httpclient.NewWithTimeout(300 * time.Second),
	}, nil
}

func (p *PaddleOCRParser) GetCapabilities() ParserCapabilities {
	return ParserCapabilities{
		Name:             "PaddleOCR",
		Type:             ParserTypePaddleOCR,
		SupportedFormats: []string{"pdf", "jpg", "jpeg", "png"},
		MaxFileSize:      20 * 1024 * 1024,
		Features:         []string{"ocr", "text_detection", "text_recognition", "multi_language", "table_recognition"},
		Description:      "百度 PaddleOCR 文本识别，支持中英文混合识别",
	}
}

func (p *PaddleOCRParser) CanParse(format string) bool {
	return format == "pdf" || format == "jpg" || format == "jpeg" || format == "png"
}

func (p *PaddleOCRParser) CreateTask(ctx context.Context, fileURL, documentID string) (string, error) {
	startTime := time.Now()

	resp, err := p.httpClient.Get(ctx, fileURL)
	if err != nil {
		return "", fmt.Errorf("failed to download file: %w", err)
	}

	if resp.StatusCode() != http.StatusOK {
		return "", fmt.Errorf("failed to download file, status: %d", resp.StatusCode())
	}

	fileBytes := resp.Body()
	const maxFileSize = 50 * 1024 * 1024
	if len(fileBytes) >= maxFileSize {
		return "", fmt.Errorf("file exceeds maximum size of 50MB")
	}

	slog.Debug("file downloaded for PaddleOCR processing",
		"document_id", documentID,
		"file_size_bytes", len(fileBytes),
		"download_duration_ms", time.Since(startTime).Milliseconds())

	encodeStart := time.Now()
	fileData := base64.StdEncoding.EncodeToString(fileBytes)
	slog.Debug("base64 encoding completed",
		"document_id", documentID,
		"encoding_duration_ms", time.Since(encodeStart).Milliseconds())

	contentType := http.DetectContentType(fileBytes)
	fileType := 0
	if strings.HasPrefix(contentType, "image/") {
		fileType = 1
	}

	reqBody := map[string]interface{}{
		"file":     fileData,
		"fileType": fileType,
	}

	if p.config.UseLayoutDetection != nil {
		reqBody["useLayoutDetection"] = *p.config.UseLayoutDetection
	} else {
		reqBody["useLayoutDetection"] = true // default for backwards compatibility
	}

	if p.config.UseDocOrientationClassify != nil {
		reqBody["useDocOrientationClassify"] = *p.config.UseDocOrientationClassify
	}
	if p.config.UseDocUnwarping != nil {
		reqBody["useDocUnwarping"] = *p.config.UseDocUnwarping
	}
	if p.config.UseChartRecognition != nil {
		reqBody["useChartRecognition"] = *p.config.UseChartRecognition
	}
	if p.config.PromptLabel != "" {
		reqBody["promptLabel"] = p.config.PromptLabel
	}
	if p.config.MergeTables != nil {
		reqBody["mergeTables"] = *p.config.MergeTables
	}
	if p.config.PrettifyMarkdown != nil {
		reqBody["prettifyMarkdown"] = *p.config.PrettifyMarkdown
	}
	if p.config.RestructurePages != nil {
		reqBody["restructurePages"] = *p.config.RestructurePages
	}
	if p.config.Visualize != nil {
		reqBody["visualize"] = *p.config.Visualize
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	slog.Debug("sending request to PaddleOCR API",
		"document_id", documentID,
		"payload_size_bytes", len(jsonData))

	apiStart := time.Now()
	apiResp, err := p.httpClient.R(ctx).
		SetHeader("Authorization", "token "+p.config.APIToken).
		SetHeader("Content-Type", "application/json").
		SetBody(jsonData).
		Post(p.config.APIURL)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}

	if apiResp.StatusCode() != http.StatusOK {
		return "", fmt.Errorf("PaddleOCR API returned status %d: %s", apiResp.StatusCode(), string(apiResp.Body()))
	}

	respBody := apiResp.Body()

	slog.Info("PaddleOCR processing completed",
		"document_id", documentID,
		"api_duration_ms", time.Since(apiStart).Milliseconds(),
		"total_duration_ms", time.Since(startTime).Milliseconds(),
		"response_size_bytes", len(respBody))

	p.storeResult(documentID, respBody)

	return documentID, nil
}

type resultCache struct {
	mu      sync.RWMutex
	results map[string]*cacheEntry
}

type cacheEntry struct {
	data      []byte
	timestamp time.Time
}

var (
	resultStore = &resultCache{results: make(map[string]*cacheEntry)}
	cacheTTL    = 1 * time.Hour
	cleanupOnce sync.Once
)

func (p *PaddleOCRParser) storeResult(taskID string, data []byte) {
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

	if time.Since(entry.timestamp) > cacheTTL {
		return nil, false
	}

	return entry.data, true
}

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

func (p *PaddleOCRParser) GetTaskStatus(ctx context.Context, taskID string) (*TaskStatus, error) {
	if _, ok := p.getStoredResult(taskID); ok {
		return &TaskStatus{
			State:        "completed",
			ResultURL:    "",
			ErrorMessage: "",
		}, nil
	}

	return &TaskStatus{
		State:        "failed",
		ErrorMessage: "Task result not found",
	}, nil
}

func (p *PaddleOCRParser) FetchResult(ctx context.Context, taskID string, resultURL string) (map[string]interface{}, error) {
	data, ok := p.getStoredResult(taskID)
	if !ok {
		return nil, fmt.Errorf("result not found for task %s", taskID)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal result JSON: %w", err)
	}

	if res, ok := result["result"].(map[string]interface{}); ok {
		if parseResultURL, ok := res["parse_result_url"].(string); ok && parseResultURL != "" {
			slog.Info("downloading parse_result_url for full layout data", "task_id", taskID)
			fullResult, err := p.downloadParseResult(ctx, parseResultURL)
			if err != nil {
				slog.Warn("failed to download parse_result_url, using fallback", "error", err)
			} else {
				return fullResult, nil
			}
		}
	}

	return result, nil
}

func (p *PaddleOCRParser) downloadParseResult(ctx context.Context, url string) (map[string]interface{}, error) {
	resp, err := p.httpClient.Get(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("failed to download: %w", err)
	}

	if resp.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("download failed with status %d", resp.StatusCode())
	}

	var result map[string]interface{}
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON: %w", err)
	}

	slog.Debug("downloaded parse result", "size_bytes", len(resp.Body()))
	return result, nil
}

func (p *PaddleOCRParser) NormalizeResult(rawData map[string]interface{}) (map[string]interface{}, error) {
	metadata := map[string]interface{}{
		"source": "paddleocr",
	}

	pageSizes := extractPaddleOCRPageSizes(rawData)
	if len(pageSizes) > 0 {
		metadata["page_sizes"] = pageSizes
	}

	normalized := map[string]interface{}{
		"paragraphs": normalizePaddleOCRParagraphs(rawData),
		"tables":     []interface{}{},
		"images":     extractPaddleOCRImages(rawData),
		"metadata":   metadata,
	}

	return normalized, nil
}

func extractPaddleOCRPageSizes(data map[string]interface{}) []map[string]interface{} {
	pageSizes := []map[string]interface{}{}

	if result, ok := data["result"].(map[string]interface{}); ok {
		if layoutResults, ok := result["layoutParsingResults"].([]interface{}); ok {
			for pageIdx, layoutData := range layoutResults {
				if layout, ok := layoutData.(map[string]interface{}); ok {
					if prunedResult, ok := layout["prunedResult"].(map[string]interface{}); ok {
						width, _ := prunedResult["width"].(float64)
						height, _ := prunedResult["height"].(float64)
						if width > 0 && height > 0 {
							pageSizes = append(pageSizes, map[string]interface{}{
								"page_idx": pageIdx,
								"width":    width,
								"height":   height,
							})
						}
					}
				}
			}
		}
	}

	return pageSizes
}

func extractPaddleOCRImages(data map[string]interface{}) []interface{} {
	images := []interface{}{}

	if result, ok := data["result"].(map[string]interface{}); ok {
		if layoutResults, ok := result["layoutParsingResults"].([]interface{}); ok {
			for _, layoutData := range layoutResults {
				if layout, ok := layoutData.(map[string]interface{}); ok {
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

func normalizePaddleOCRParagraphs(data map[string]interface{}) []interface{} {
	paragraphs := []interface{}{}

	if pages, ok := data["pages"].([]interface{}); ok {
		for _, pageData := range pages {
			if page, ok := pageData.(map[string]interface{}); ok {
				pageNum := 1
				if pn, ok := page["page_num"].(float64); ok {
					pageNum = int(pn) + 1
				}

				if layouts, ok := page["layouts"].([]interface{}); ok {
					for idx, layoutData := range layouts {
						if layout, ok := layoutData.(map[string]interface{}); ok {
							text, _ := layout["text"].(string)
							if text == "" {
								continue
							}

							layoutType, _ := layout["type"].(string)
							if layoutType == "table" || layoutType == "image" {
								continue
							}

							paragraph := map[string]interface{}{
								"page":  pageNum,
								"index": idx,
								"type":  layoutType,
								"text":  text,
							}

							if pos, ok := layout["position"].([]interface{}); ok && len(pos) == 4 {
								x, _ := pos[0].(float64)
								y, _ := pos[1].(float64)
								w, _ := pos[2].(float64)
								h, _ := pos[3].(float64)
								paragraph["bbox"] = []float64{x, y, x + w, y + h}
							}

							paragraphs = append(paragraphs, paragraph)
						}
					}
				}
			}
		}
	}

	if len(paragraphs) == 0 {
		if result, ok := data["result"].(map[string]interface{}); ok {
			if layoutResults, ok := result["layoutParsingResults"].([]interface{}); ok {
				for pageIdx, layoutData := range layoutResults {
					if layout, ok := layoutData.(map[string]interface{}); ok {
						pageParaCount := 0 // Track paragraphs added for THIS page

						// Try prunedResult.parsing_res_list first (new PaddleOCR API format)
						if prunedResult, ok := layout["prunedResult"].(map[string]interface{}); ok {
							if parsingResList, ok := prunedResult["parsing_res_list"].([]interface{}); ok {
								for idx, blockData := range parsingResList {
									if block, ok := blockData.(map[string]interface{}); ok {
										content, _ := block["block_content"].(string)
										if content == "" {
											continue
										}
										blockLabel, _ := block["block_label"].(string)
										if blockLabel == "table" || blockLabel == "image" || blockLabel == "header_image" {
											continue
										}

										paragraph := map[string]interface{}{
											"page":  pageIdx + 1,
											"index": idx,
											"type":  blockLabel,
											"text":  content,
										}

										if bbox, ok := block["block_bbox"].([]interface{}); ok && len(bbox) == 4 {
											x0, _ := bbox[0].(float64)
											y0, _ := bbox[1].(float64)
											x1, _ := bbox[2].(float64)
											y1, _ := bbox[3].(float64)
											paragraph["bbox"] = []float64{x0, y0, x1, y1}
										}

										paragraphs = append(paragraphs, paragraph)
										pageParaCount++
									}
								}
							}
						}

						// Fallback to pdfLayouts (legacy format)
						if pageParaCount == 0 {
							if pdfLayouts, ok := layout["pdfLayouts"].([]interface{}); ok {
								for idx, blockData := range pdfLayouts {
									if block, ok := blockData.(map[string]interface{}); ok {
										content, _ := block["block_content"].(string)
										if content == "" {
											continue
										}
										blockLabel, _ := block["block_label"].(string)
										if blockLabel == "table" || blockLabel == "image" {
											continue
										}

										paragraph := map[string]interface{}{
											"page":  pageIdx + 1,
											"index": idx,
											"type":  blockLabel,
											"text":  content,
										}

										if bbox, ok := block["block_bbox"].([]interface{}); ok && len(bbox) == 4 {
											x0, _ := bbox[0].(float64)
											y0, _ := bbox[1].(float64)
											x1, _ := bbox[2].(float64)
											y1, _ := bbox[3].(float64)
											paragraph["bbox"] = []float64{x0, y0, x1, y1}
										}

										paragraphs = append(paragraphs, paragraph)
										pageParaCount++
									}
								}
							}
						}

						// Fallback to markdown.text only if THIS page has no paragraphs from pdfLayouts
						if pageParaCount == 0 {
							if markdown, ok := layout["markdown"].(map[string]interface{}); ok {
								if text, ok := markdown["text"].(string); ok && text != "" {
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
		}
	}

	return paragraphs
}
