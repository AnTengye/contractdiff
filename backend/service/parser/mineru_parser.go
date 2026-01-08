package parser

import (
	"context"
	"fmt"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/service"
)

// MineruParser wraps the existing MineruService to implement DocumentParser interface
type MineruParser struct {
	config  *config.MineruConfig
	service *service.MineruService
}

// NewMineruParser creates a new MinerU parser instance
func NewMineruParser(cfg *config.MineruConfig) (*MineruParser, error) {
	if cfg == nil || !cfg.Enabled {
		return nil, fmt.Errorf("MinerU parser not enabled")
	}

	return &MineruParser{
		config:  cfg,
		service: service.NewMineruService(cfg),
	}, nil
}

// GetCapabilities returns the capabilities of MinerU parser
func (p *MineruParser) GetCapabilities() ParserCapabilities {
	return ParserCapabilities{
		Name:             "MinerU",
		Type:             ParserTypeMinerU,
		SupportedFormats: []string{"pdf", "docx"},
		MaxFileSize:      50 * 1024 * 1024, // 50MB
		Features:         []string{"layout_analysis", "table_detection", "formula_recognition", "docx_support"},
		Description:      "MinerU 智能文档解析，支持复杂布局、表格和公式识别",
	}
}

// CanParse checks if MinerU can handle the given format
func (p *MineruParser) CanParse(format string) bool {
	caps := p.GetCapabilities()
	for _, f := range caps.SupportedFormats {
		if f == format {
			return true
		}
	}
	return false
}

// CreateTask creates a new parsing task in MinerU
func (p *MineruParser) CreateTask(ctx context.Context, fileURL, documentID string) (string, error) {
	resp, err := p.service.CreateTask(fileURL, documentID)
	if err != nil {
		return "", err
	}
	return resp.Data.TaskID, nil
}

// GetTaskStatus retrieves the status of a MinerU task
func (p *MineruParser) GetTaskStatus(ctx context.Context, taskID string) (*TaskStatus, error) {
	status, err := p.service.GetTaskStatus(taskID)
	if err != nil {
		return nil, err
	}

	taskStatus := &TaskStatus{
		State:        status.Data.State,
		ResultURL:    status.Data.FullZipURL,
		ErrorMessage: status.Data.ErrorMsg,
	}

	// Add progress info if available
	if status.Data.ExtractProgress.TotalPages > 0 {
		taskStatus.Progress = &ProgressInfo{
			ProcessedPages: status.Data.ExtractProgress.ExtractedPages,
			TotalPages:     status.Data.ExtractProgress.TotalPages,
		}

		// Parse start time if available
		if status.Data.ExtractProgress.StartTime != "" {
			if startTime, err := time.Parse(time.RFC3339, status.Data.ExtractProgress.StartTime); err == nil {
				taskStatus.Progress.StartTime = startTime
			}
		}
	}

	return taskStatus, nil
}

// FetchResult downloads and extracts the JSON result from MinerU
func (p *MineruParser) FetchResult(ctx context.Context, taskID string, resultURL string) (map[string]interface{}, error) {
	return p.service.FetchZipAndExtractJSON(resultURL)
}

// NormalizeResult converts MinerU output to standard format
// MinerU output is already well-structured, we just ensure consistent field names
func (p *MineruParser) NormalizeResult(rawData map[string]interface{}) (map[string]interface{}, error) {
	normalized := map[string]interface{}{
		"paragraphs": extractParagraphs(rawData),
		"tables":     extractTables(rawData),
		"images":     extractImages(rawData),
		"metadata":   extractMetadata(rawData),
	}

	return normalized, nil
}

// Helper functions for normalization

func extractParagraphs(data map[string]interface{}) []interface{} {
	// MinerU typically has a pdf_info array with page blocks
	if pdfInfo, ok := data["pdf_info"].([]interface{}); ok {
		paragraphs := []interface{}{}

		for pageIdx, pageData := range pdfInfo {
			if page, ok := pageData.(map[string]interface{}); ok {
				// Extract para_blocks from each page
				if paraBlocks, ok := page["para_blocks"].([]interface{}); ok {
					for _, block := range paraBlocks {
						if blockMap, ok := block.(map[string]interface{}); ok {
							// Add page number to each paragraph
							blockMap["page"] = pageIdx + 1
							paragraphs = append(paragraphs, blockMap)
						}
					}
				}
			}
		}

		return paragraphs
	}

	// Fallback: try direct paragraphs field
	if paras, ok := data["paragraphs"].([]interface{}); ok {
		return paras
	}

	return []interface{}{}
}

func extractTables(data map[string]interface{}) []interface{} {
	// Try to extract tables from pdf_info
	if pdfInfo, ok := data["pdf_info"].([]interface{}); ok {
		tables := []interface{}{}

		for pageIdx, pageData := range pdfInfo {
			if page, ok := pageData.(map[string]interface{}); ok {
				if paraBlocks, ok := page["para_blocks"].([]interface{}); ok {
					for _, block := range paraBlocks {
						if blockMap, ok := block.(map[string]interface{}); ok {
							// Check if block type is table
							if blockType, ok := blockMap["type"].(string); ok && blockType == "table" {
								blockMap["page"] = pageIdx + 1
								tables = append(tables, blockMap)
							}
						}
					}
				}
			}
		}

		return tables
	}

	// Fallback: direct tables field
	if tables, ok := data["tables"].([]interface{}); ok {
		return tables
	}

	return []interface{}{}
}

func extractImages(data map[string]interface{}) []interface{} {
	// Try to extract images from pdf_info
	if pdfInfo, ok := data["pdf_info"].([]interface{}); ok {
		images := []interface{}{}

		for pageIdx, pageData := range pdfInfo {
			if page, ok := pageData.(map[string]interface{}); ok {
				if paraBlocks, ok := page["para_blocks"].([]interface{}); ok {
					for _, block := range paraBlocks {
						if blockMap, ok := block.(map[string]interface{}); ok {
							// Check if block type is image
							if blockType, ok := blockMap["type"].(string); ok && blockType == "image" {
								blockMap["page"] = pageIdx + 1
								images = append(images, blockMap)
							}
						}
					}
				}
			}
		}

		return images
	}

	// Fallback: direct images field
	if images, ok := data["images"].([]interface{}); ok {
		return images
	}

	return []interface{}{}
}

func extractMetadata(data map[string]interface{}) map[string]interface{} {
	metadata := map[string]interface{}{
		"source": "mineru",
	}

	// Extract page count
	if pdfInfo, ok := data["pdf_info"].([]interface{}); ok {
		metadata["page_count"] = len(pdfInfo)
	}

	// Try to extract any existing metadata
	if meta, ok := data["metadata"].(map[string]interface{}); ok {
		for k, v := range meta {
			metadata[k] = v
		}
	}

	return metadata
}
