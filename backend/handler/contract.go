package handler

import (
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/AnTengye/contractdiff/backend/middleware"
	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type ContractHandler struct {
	minioService  *service.MinioService
	mineruService *service.MineruService
	store         *service.ContractStore
}

func NewContractHandler(minioSvc *service.MinioService, mineruSvc *service.MineruService) *ContractHandler {
	return &ContractHandler{
		minioService:  minioSvc,
		mineruService: mineruSvc,
		store:         service.GetContractStore(),
	}
}

// Upload handles contract file upload
func (h *ContractHandler) Upload(c *gin.Context) {
	tenant := middleware.GetTenant(c)

	// Get file from form
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file provided"})
		return
	}
	defer file.Close()

	// Validate file type - PDF and DOCX allowed
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext != ".pdf" && ext != ".docx" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only PDF and DOCX files are allowed"})
		return
	}

	// Determine content type based on extension
	var expectedContentType string
	if ext == ".pdf" {
		expectedContentType = "application/pdf"
	} else {
		expectedContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	}

	// Validate content type
	contentType := header.Header.Get("Content-Type")
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = expectedContentType
	} else if ext == ".pdf" && !strings.Contains(contentType, "pdf") {
		// Try to detect from file header for PDF
		buffer := make([]byte, 512)
		_, err := file.Read(buffer)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read file"})
			return
		}
		file.Seek(0, io.SeekStart) // Reset file pointer

		detectedType := http.DetectContentType(buffer)
		if !strings.Contains(detectedType, "pdf") && detectedType != "application/octet-stream" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file type"})
			return
		}
		contentType = "application/pdf"
	} else if ext == ".docx" {
		contentType = expectedContentType
	}

	// Generate unique ID and object name
	contractID := uuid.New().String()
	objectName := fmt.Sprintf("%s/%s/%s", tenant, contractID, header.Filename)

	// Upload to MINIO
	err = h.minioService.UploadFile(c.Request.Context(), objectName, file, header.Size, contentType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upload file: " + err.Error()})
		return
	}

	// Get presigned URL for MinerU
	pdfURL, err := h.minioService.GetPresignedURL(c.Request.Context(), objectName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate URL: " + err.Error()})
		return
	}

	// Create contract record
	contract := &model.Contract{
		ID:        contractID,
		Filename:  header.Filename,
		Tenant:    tenant,
		PDFURL:    pdfURL,
		Status:    model.StatusPending,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	h.store.Save(contract)

	// Call MinerU API
	go h.processMineruTask(contract, pdfURL)

	c.JSON(http.StatusOK, gin.H{
		"id":       contractID,
		"filename": header.Filename,
		"pdf_url":  pdfURL,
		"status":   model.StatusPending,
	})
}

// processMineruTask handles the MinerU extraction task asynchronously
func (h *ContractHandler) processMineruTask(contract *model.Contract, pdfURL string) {
	fmt.Printf("[MinerU] Starting task for contract %s, PDF URL: %s\n", contract.ID, pdfURL)

	// Update status to processing
	h.store.UpdateStatus(contract.ID, model.StatusProcessing, "")

	// Create task
	resp, err := h.mineruService.CreateTask(pdfURL, contract.ID)
	if err != nil {
		fmt.Printf("[MinerU] Failed to create task: %v\n", err)
		h.store.UpdateStatus(contract.ID, model.StatusFailed, err.Error())
		return
	}

	fmt.Printf("[MinerU] Task created successfully, TaskID: %s\n", resp.Data.TaskID)

	// Update task ID
	contract.MineruTaskID = resp.Data.TaskID
	h.store.Save(contract)

	// Poll for result (if no callback configured)
	h.pollTaskResult(contract)
}

// pollTaskResult polls for task completion
func (h *ContractHandler) pollTaskResult(contract *model.Contract) {
	fmt.Printf("[MinerU] Starting to poll for contract %s, TaskID: %s\n", contract.ID, contract.MineruTaskID)

	maxAttempts := 60 // 5 minutes with 5 second intervals
	for i := 0; i < maxAttempts; i++ {
		time.Sleep(5 * time.Second)

		status, err := h.mineruService.GetTaskStatus(contract.MineruTaskID)
		if err != nil {
			fmt.Printf("[MinerU] Poll attempt %d failed: %v\n", i+1, err)
			continue
		}

		fmt.Printf("[MinerU] Poll attempt %d - State: %s, ZipURL: %s\n", i+1, status.Data.State, status.Data.FullZipURL)

		switch status.Data.State {
		case "done":
			// Fetch JSON from ZIP
			if status.Data.FullZipURL != "" {
				fmt.Printf("[MinerU] Downloading and extracting ZIP from: %s\n", status.Data.FullZipURL)
				jsonData, err := h.mineruService.FetchZipAndExtractJSON(status.Data.FullZipURL)
				if err != nil {
					fmt.Printf("[MinerU] Failed to fetch/extract JSON: %v\n", err)
					h.store.UpdateStatus(contract.ID, model.StatusFailed, "Failed to fetch JSON: "+err.Error())
					return
				}
				fmt.Printf("[MinerU] JSON extracted successfully, keys: %v\n", getMapKeys(jsonData))
				h.store.UpdateJSONData(contract.ID, jsonData)
			} else {
				fmt.Printf("[MinerU] No ZIP URL available, marking as completed without JSON\n")
				h.store.UpdateStatus(contract.ID, model.StatusCompleted, "")
			}
			return
		case "failed":
			fmt.Printf("[MinerU] Task failed: %s\n", status.Data.ErrorMsg)
			h.store.UpdateStatus(contract.ID, model.StatusFailed, status.Data.ErrorMsg)
			return
		case "running":
			if status.Data.ExtractProgress.TotalPages > 0 {
				fmt.Printf("[MinerU] Progress: %d/%d pages\n", status.Data.ExtractProgress.ExtractedPages, status.Data.ExtractProgress.TotalPages)
			}
		}
	}

	fmt.Printf("[MinerU] Task polling timeout for contract %s\n", contract.ID)
	h.store.UpdateStatus(contract.ID, model.StatusFailed, "Task polling timeout")
}

func getMapKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// List returns all contracts for the current tenant
func (h *ContractHandler) List(c *gin.Context) {
	tenant := middleware.GetTenant(c)
	contracts := h.store.GetByTenant(tenant)

	// Return without JSON data for list view
	result := make([]gin.H, len(contracts))
	for i, contract := range contracts {
		result[i] = gin.H{
			"id":         contract.ID,
			"filename":   contract.Filename,
			"status":     contract.Status,
			"pdf_url":    contract.PDFURL,
			"created_at": contract.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			"updated_at": contract.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	c.JSON(http.StatusOK, gin.H{"contracts": result})
}

// Get returns a single contract with JSON data
func (h *ContractHandler) Get(c *gin.Context) {
	tenant := middleware.GetTenant(c)
	id := c.Param("id")

	contract := h.store.Get(id)
	if contract == nil || contract.Tenant != tenant {
		c.JSON(http.StatusNotFound, gin.H{"error": "Contract not found"})
		return
	}

	c.JSON(http.StatusOK, contract)
}

// GetStatus returns the processing status of a contract
func (h *ContractHandler) GetStatus(c *gin.Context) {
	tenant := middleware.GetTenant(c)
	id := c.Param("id")

	contract := h.store.Get(id)
	if contract == nil || contract.Tenant != tenant {
		c.JSON(http.StatusNotFound, gin.H{"error": "Contract not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":        contract.ID,
		"status":    contract.Status,
		"error_msg": contract.ErrorMsg,
	})
}

// Delete deletes a contract
func (h *ContractHandler) Delete(c *gin.Context) {
	tenant := middleware.GetTenant(c)
	id := c.Param("id")

	contract := h.store.Get(id)
	if contract == nil || contract.Tenant != tenant {
		c.JSON(http.StatusNotFound, gin.H{"error": "Contract not found"})
		return
	}

	h.store.Delete(id)

	c.JSON(http.StatusOK, gin.H{"message": "Contract deleted"})
}
