package model

import (
	"testing"
	"time"
)

func TestContractStruct(t *testing.T) {
	contract := &Contract{
		ID:           "test-id",
		Filename:     "test.pdf",
		Tenant:       "tenant1",
		PDFURL:       "http://example.com/test.pdf",
		Status:       StatusPending,
		MineruTaskID: "task-123",
		JSONData:     map[string]interface{}{"key": "value"},
		ErrorMsg:     "",
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	if contract.ID != "test-id" {
		t.Errorf("Expected ID 'test-id', got '%s'", contract.ID)
	}
	if contract.Status != StatusPending {
		t.Errorf("Expected status '%s', got '%s'", StatusPending, contract.Status)
	}
}

func TestContractStatusConstants(t *testing.T) {
	statuses := []string{StatusPending, StatusProcessing, StatusCompleted, StatusFailed}
	expected := []string{"pending", "processing", "completed", "failed"}

	for i, status := range statuses {
		if status != expected[i] {
			t.Errorf("Expected '%s', got '%s'", expected[i], status)
		}
	}
}
