package model

import (
	"encoding/json"
	"time"
)

type FeedbackRegion struct {
	Side string    `json:"side"`
	Page int       `json:"page"`
	BBox []float64 `json:"bbox,omitempty"`
	Text string    `json:"text,omitempty"`
}

type RegressionExpectation struct {
	TotalChanges *int   `json:"total_changes,omitempty"`
	LeftText     string `json:"left_text,omitempty"`
	RightText    string `json:"right_text,omitempty"`
}

type Feedback struct {
	ID                string                 `json:"id"`
	Tenant            string                 `json:"tenant"`
	Reporter          string                 `json:"reporter"`
	Category          string                 `json:"category"`
	Description       string                 `json:"description"`
	Expected          string                 `json:"expected"`
	Status            string                 `json:"status"`
	Revision          int                    `json:"revision"`
	ComparisonID      string                 `json:"comparison_id,omitempty"`
	LeftID            string                 `json:"left_id,omitempty"`
	RightID           string                 `json:"right_id,omitempty"`
	Region            *FeedbackRegion        `json:"region,omitempty"`
	SnapshotKey       string                 `json:"-"`
	Files             map[string]string      `json:"-"`
	ResolutionVersion string                 `json:"resolution_version,omitempty"`
	Regression        *RegressionExpectation `json:"regression,omitempty"`
	CreatedAt         time.Time              `json:"created_at"`
	UpdatedAt         time.Time              `json:"updated_at"`
	Events            []FeedbackEvent        `json:"events,omitempty"`
}

type FeedbackEvent struct {
	Actor     string    `json:"actor"`
	Status    string    `json:"status"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

type FeedbackDocument struct {
	ID                   string                 `json:"id"`
	Filename             string                 `json:"filename"`
	OriginalFormat       string                 `json:"original_format"`
	FileHash             string                 `json:"file_hash"`
	PDFHash              string                 `json:"pdf_hash"`
	ParserType           string                 `json:"parser_type"`
	ParserVersion        string                 `json:"parser_version"`
	ParserSignature      string                 `json:"parser_signature"`
	ProcessingSignature  string                 `json:"processing_signature"`
	ResultSignature      string                 `json:"result_signature"`
	ConversionRevision   string                 `json:"conversion_revision,omitempty"`
	ParserSettings       map[string]interface{} `json:"parser_settings"`
	NormalizationVersion string                 `json:"normalization_version"`
	Status               string                 `json:"status"`
	Error                string                 `json:"error,omitempty"`
	FailureStage         string                 `json:"failure_stage,omitempty"`
	CoordinateStatus     string                 `json:"coordinate_status,omitempty"`
	CoordinateWarnings   []string               `json:"coordinate_warnings,omitempty"`
	TaskID               string                 `json:"task_id,omitempty"`
	RequestID            string                 `json:"request_id,omitempty"`
	TraceID              string                 `json:"trace_id,omitempty"`
	Data                 any                    `json:"data,omitempty"`
	RawData              any                    `json:"raw_data,omitempty"`
	Metadata             *ContractMetadata      `json:"metadata,omitempty"`
}

type FeedbackSnapshot struct {
	SchemaVersion string                      `json:"schema_version"`
	CreatedAt     time.Time                   `json:"created_at"`
	Documents     map[string]FeedbackDocument `json:"documents"`
	Comparison    json.RawMessage             `json:"comparison,omitempty"`
}
