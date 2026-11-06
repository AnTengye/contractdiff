package model

import (
	"time"
)

// Contract represents a contract document
type Contract struct {
	ID       string `json:"id"`
	Filename string `json:"filename"`
	Tenant   string `json:"tenant"`

	// File information
	OriginalFormat   string `json:"original_format"`              // "pdf" or "docx"
	FileURL          string `json:"file_url"`                     // Presigned URL of original file
	ConvertedFileURL string `json:"converted_file_url,omitempty"` // If DOCX was converted to PDF
	FileHash         string `json:"file_hash,omitempty"`          // SHA256 hash for deduplication
	PDFHash          string `json:"pdf_hash,omitempty"`           // SHA256 hash of the exact PDF sent to the parser
	FileSize         int64  `json:"file_size,omitempty"`          // File size in bytes

	// Backward compatibility
	PDFURL       string `json:"pdf_url"`                  // Deprecated: use FileURL or GetPDFURL()
	MineruTaskID string `json:"mineru_task_id,omitempty"` // Deprecated: use TaskID

	// Parser information
	ParserType           string                 `json:"parser_type"`              // "mineru", "paddleocr", etc.
	ParserVersion        string                 `json:"parser_version,omitempty"` // Parser version used
	ParserSignature      string                 `json:"parser_signature,omitempty"`
	ProcessingSignature  string                 `json:"processing_signature,omitempty"`
	ResultSignature      string                 `json:"result_signature,omitempty"`
	ConversionRevision   string                 `json:"conversion_revision,omitempty"`
	ParserSettings       map[string]interface{} `json:"parser_settings,omitempty"`
	NormalizationVersion string                 `json:"normalization_version,omitempty"`
	FileObjectKey        string                 `json:"-"`
	PDFObjectKey         string                 `json:"-"`
	RequestID            string                 `json:"request_id,omitempty"`
	TraceID              string                 `json:"trace_id,omitempty"`
	TaskID               string                 `json:"task_id,omitempty"` // Parser-specific task ID

	// Processing status
	Status             string   `json:"status"` // pending, converting, processing, completed, failed
	ErrorMsg           string   `json:"error_msg,omitempty"`
	FailureStage       string   `json:"failure_stage,omitempty"`     // conversion, parser, normalization, preview
	CoordinateStatus   string   `json:"coordinate_status,omitempty"` // complete, partial, unavailable
	CoordinateWarnings []string `json:"coordinate_warnings,omitempty"`

	// Deduplication info
	IsDuplicate    bool   `json:"is_duplicate,omitempty"`    // Whether this is a duplicate
	OriginalID     string `json:"original_id,omitempty"`     // ID of the original contract if duplicate
	DuplicateCount int    `json:"duplicate_count,omitempty"` // Number of times this file was uploaded

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
	PageCount          int               `json:"page_count,omitempty"`
	PDFPages           []PDFPageMetadata `json:"pdf_pages,omitempty"`
	ProcessingDuration int64             `json:"processing_duration_ms,omitempty"` // milliseconds
	ConvertedFromDOCX  bool              `json:"converted_from_docx"`
	ConversionDuration int64             `json:"conversion_duration_ms,omitempty"`
	Steps              map[string]int64  `json:"steps_ms,omitempty"`
}

// PDFPageMetadata is the geometry of the canonical PDF page used by both the
// parser and the viewer. Coordinates are never synthesized from the parser
// result; this is only a record of the validated input PDF.
type PDFPageMetadata struct {
	PageIdx  int        `json:"page_idx"`
	Width    float64    `json:"width"`
	Height   float64    `json:"height"`
	Rotation int        `json:"rotation"`
	CropBox  [4]float64 `json:"crop_box,omitempty"`
}

// GetPDFURL returns only an explicitly recorded PDF URL. The original DOCX URL
// is never a valid preview fallback.
func (c *Contract) GetPDFURL() string {
	if c.OriginalFormat == "docx" {
		if c.PDFHash == "" || c.PDFObjectKey == "" {
			return ""
		}
		return c.ConvertedFileURL
	}
	if c.OriginalFormat == "pdf" && c.PDFURL != "" {
		return c.PDFURL
	}
	if c.ConvertedFileURL != "" {
		return c.ConvertedFileURL
	}
	return c.PDFURL
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
