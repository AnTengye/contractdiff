package parser

import (
	"context"
	"time"
)

// ParserType represents the type of document parser
type ParserType string

const (
	ParserTypeMinerU    ParserType = "mineru"
	ParserTypePaddleOCR ParserType = "paddleocr"
	ParserTypeGOTOCR    ParserType = "got-ocr"
	ParserTypeRAGFlow   ParserType = "ragflow"
)

// ParserCapabilities defines what a parser can do
type ParserCapabilities struct {
	Name             string     `json:"name"`              // Display name (e.g., "MinerU")
	Type             ParserType `json:"type"`              // Unique identifier
	SupportedFormats []string   `json:"supported_formats"` // e.g., ["pdf", "docx"]
	MaxFileSize      int64      `json:"max_file_size"`     // Maximum file size in bytes (0 = unlimited)
	Features         []string   `json:"features"`          // e.g., ["table_detection", "layout_analysis"]
	Description      string     `json:"description"`       // User-friendly description
}

// TaskStatus represents the status of a parsing task
type TaskStatus struct {
	State        string                 `json:"state"`          // pending, running, done, failed, converting
	Progress     *ProgressInfo          `json:"progress"`       // Optional progress information
	ResultURL    string                 `json:"result_url"`     // URL to download results (if available)
	ErrorMessage string                 `json:"error_message"`  // Error message if failed
	RawData      map[string]interface{} `json:"raw_data"`       // Raw response from parser
}

// ProgressInfo provides progress details during parsing
type ProgressInfo struct {
	ProcessedPages int       `json:"processed_pages"`
	TotalPages     int       `json:"total_pages"`
	StartTime      time.Time `json:"start_time"`
}

// ParseResult contains the standardized output from any parser
type ParseResult struct {
	ParserType    ParserType             `json:"parser_type"`    // Which parser was used
	ParserVersion string                 `json:"parser_version"` // Version of the parser
	DocumentID    string                 `json:"document_id"`    // Unique identifier for the document
	TaskID        string                 `json:"task_id"`        // Parser-specific task ID
	JSONData      map[string]interface{} `json:"json_data"`      // Standardized JSON format
	RawData       map[string]interface{} `json:"raw_data"`       // Original parser output (for debugging)
	Metadata      *ParseMetadata         `json:"metadata"`       // Additional metadata
}

// ParseMetadata contains additional information about the parsing process
type ParseMetadata struct {
	PageCount         int           `json:"page_count"`
	ProcessingTime    time.Duration `json:"processing_time"`
	FileFormat        string        `json:"file_format"` // "pdf" or "docx"
	ConvertedFromDOCX bool          `json:"converted_from_docx"`
}

// DocumentParser is the interface that all parsers must implement
type DocumentParser interface {
	// GetCapabilities returns what this parser can do
	GetCapabilities() ParserCapabilities

	// CanParse checks if this parser can handle the given file format
	CanParse(format string) bool

	// CreateTask submits a document for parsing
	// Returns taskID and error
	CreateTask(ctx context.Context, fileURL, documentID string) (string, error)

	// GetTaskStatus checks the status of a parsing task
	GetTaskStatus(ctx context.Context, taskID string) (*TaskStatus, error)

	// FetchResult downloads and parses the result
	// Returns the raw parser output (before normalization)
	FetchResult(ctx context.Context, taskID string, resultURL string) (map[string]interface{}, error)

	// NormalizeResult converts parser-specific output to standard format
	// This is the adapter pattern implementation
	NormalizeResult(rawData map[string]interface{}) (map[string]interface{}, error)
}
