package model

import (
	"time"
)

// Contract represents a contract document
type Contract struct {
	ID       string    `json:"id"`
	Filename string    `json:"filename"`
	Tenant   string    `json:"tenant"`

	// File information
	OriginalFormat   string `json:"original_format"`                // "pdf" or "docx"
	FileURL          string `json:"file_url"`                       // Presigned URL of original file
	ConvertedFileURL string `json:"converted_file_url,omitempty"`   // If DOCX was converted to PDF
	FileHash         string `json:"file_hash,omitempty"`            // SHA256 hash for deduplication
	FileSize         int64  `json:"file_size,omitempty"`            // File size in bytes

	// Backward compatibility
	PDFURL       string `json:"pdf_url"`                  // Deprecated: use FileURL or GetPDFURL()
	MineruTaskID string `json:"mineru_task_id,omitempty"` // Deprecated: use TaskID

	// Parser information
	ParserType    string `json:"parser_type"`              // "mineru", "paddleocr", etc.
	ParserVersion string `json:"parser_version,omitempty"` // Parser version used
	TaskID        string `json:"task_id,omitempty"`        // Parser-specific task ID

	// Processing status
	Status   string `json:"status"` // pending, converting, processing, completed, failed
	ErrorMsg string `json:"error_msg,omitempty"`

	// Deduplication info
	IsDuplicate      bool   `json:"is_duplicate,omitempty"`       // Whether this is a duplicate
	OriginalID       string `json:"original_id,omitempty"`        // ID of the original contract if duplicate
	DuplicateCount   int    `json:"duplicate_count,omitempty"`    // Number of times this file was uploaded

	// Results
	JSONData    any `json:"json_data,omitempty"`     // Normalized data
	RawJSONData any `json:"raw_json_data,omitempty"` // Original parser output

	// Metadata
	Metadata *ContractMetadata `json:"metadata,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ContractMetadata stores additional processing information
type ContractMetadata struct {
	PageCount          int   `json:"page_count,omitempty"`
	ProcessingDuration int64 `json:"processing_duration_ms,omitempty"` // milliseconds
	ConvertedFromDOCX  bool  `json:"converted_from_docx"`
	ConversionDuration int64 `json:"conversion_duration_ms,omitempty"`
}

// GetPDFURL returns the PDF URL for backward compatibility
// Prioritizes converted file URL if DOCX was converted, otherwise returns original file URL
func (c *Contract) GetPDFURL() string {
	if c.ConvertedFileURL != "" {
		return c.ConvertedFileURL
	}
	if c.FileURL != "" {
		return c.FileURL
	}
	return c.PDFURL // Fallback to deprecated field
}

// GetTaskID returns the task ID for the selected parser
func (c *Contract) GetTaskID() string {
	if c.TaskID != "" {
		return c.TaskID
	}
	return c.MineruTaskID // Fallback to deprecated field
}

// ContractStatus constants
const (
	StatusPending    = "pending"
	StatusConverting = "converting" // NEW: DOCX to PDF conversion in progress
	StatusProcessing = "processing"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
)
