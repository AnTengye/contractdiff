package model

import (
	"time"
)

// Contract represents a contract document
type Contract struct {
	ID           string    `json:"id"`
	Filename     string    `json:"filename"`
	Tenant       string    `json:"tenant"`
	PDFURL       string    `json:"pdf_url"`
	Status       string    `json:"status"` // pending, processing, completed, failed
	MineruTaskID string    `json:"mineru_task_id,omitempty"`
	JSONData     any       `json:"json_data,omitempty"`
	ErrorMsg     string    `json:"error_msg,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// ContractStatus constants
const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
)
