package aidiff

import "time"

const Version = "ai-diff-v1"

type Options struct {
	IgnoreWhitespace  bool `json:"ignore_whitespace"`
	IgnorePunctuation bool `json:"ignore_punctuation"`
	IgnoreHeaders     bool `json:"ignore_headers"`
}

type Hint struct {
	Before string `json:"before"`
	After  string `json:"after"`
}

type Unit struct {
	ID        string `json:"id"`
	Index     int    `json:"index"`
	PageIdx   int    `json:"page_idx"`
	BlockIdx  int    `json:"block_idx"`
	Text      string `json:"text"`
	Kind      string `json:"kind"`
	Structure string `json:"structure,omitempty"`
}

type Document struct {
	PDFHash         string `json:"pdf_hash"`
	ResultSignature string `json:"result_signature"`
	Units           []Unit `json:"units"`
}

type Reference struct {
	UnitIDs []string `json:"unit_ids"`
	Quote   string   `json:"quote"`
}

type Range struct {
	UnitIndex int    `json:"unit_index"`
	UnitID    string `json:"unit_id"`
	Start     int    `json:"start"` // UTF-16 offsets, matching JavaScript string indices.
	End       int    `json:"end"`
}

type Candidate struct {
	Ranges []Range `json:"ranges"`
}

type Location struct {
	Status     string      `json:"status"` // verified, ambiguous, unresolved, not_applicable
	Quote      string      `json:"quote"`
	Candidates []Candidate `json:"candidates"`
	Reason     string      `json:"reason,omitempty"`
}

type Finding struct {
	ID       string   `json:"id"`
	Category string   `json:"category"` // text, format
	Kind     string   `json:"kind"`     // added, removed, modified, moved
	Summary  string   `json:"summary"`
	Before   Location `json:"before"`
	After    Location `json:"after"`
	Source   string   `json:"source"` // ai, native_style, vision
}

type Job struct {
	ID           string              `json:"id"`
	Status       string              `json:"status"` // queued, running, completed, partial, failed
	TextStatus   string              `json:"text_status"`
	Phase        string              `json:"phase"`
	Model        string              `json:"model"`
	Reasoning    string              `json:"reasoning"`
	Documents    map[string]Document `json:"documents"`
	Findings     []Finding           `json:"findings"`
	FormatStatus string              `json:"format_status"` // completed, unavailable, partial
	VisualPages  []PagePair          `json:"visual_pages"`
	Error        string              `json:"error,omitempty"`
	Warnings     []string            `json:"warnings"`
	CreatedAt    time.Time           `json:"created_at"`
	FinishedAt   *time.Time          `json:"finished_at,omitempty"`
}

type PageImage struct {
	PageIdx int    `json:"page_idx"`
	DataURL string `json:"data_url"`
}
type PagePair struct {
	Left  int `json:"left"`
	Right int `json:"right"`
}
type VisualRequest struct {
	Left  PageImage `json:"left"`
	Right PageImage `json:"right"`
}

type ModelFinding struct {
	Kind    string    `json:"kind"`
	Summary string    `json:"summary"`
	Before  Reference `json:"before"`
	After   Reference `json:"after"`
}

type ModelResult struct {
	Complete    bool           `json:"complete"`
	Differences []ModelFinding `json:"differences"`
	Notes       []string       `json:"notes"`
}
