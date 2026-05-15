package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/middleware"
	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/AnTengye/contractdiff/backend/pkg/httpclient"
	"github.com/AnTengye/contractdiff/backend/pkg/timing"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/AnTengye/contractdiff/backend/service/converter"
	"github.com/AnTengye/contractdiff/backend/service/parser"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type ContractHandler struct {
	minioService   *service.MinioService
	parserRegistry *parser.Registry
	converter      *converter.GotenbergConverter
	store          *service.ContractStore
	httpClient     *httpclient.Client
	timingConfig   *config.TimingConfig
	timingAlerter  timing.Alerter
}

func NewContractHandler(
	minioSvc *service.MinioService,
	parserRegistry *parser.Registry,
	converter *converter.GotenbergConverter,
	timingCfg *config.TimingConfig,
	timingAlerter timing.Alerter,
) *ContractHandler {
	return &ContractHandler{
		minioService:   minioSvc,
		parserRegistry: parserRegistry,
		converter:      converter,
		store:          service.GetContractStore(),
		httpClient:     httpclient.New(),
		timingConfig:   timingCfg,
		timingAlerter:  timingAlerter,
	}
}

// Upload handles contract file upload
func (h *ContractHandler) Upload(c *gin.Context) {
	tenant := middleware.GetTenant(c)
	requestID := middleware.GetRequestID(c)

	// Get parser type from form (optional, defaults to "mineru")
	parserTypeStr := c.PostForm("parser_type")
	if parserTypeStr == "" {
		parserTypeStr = "mineru" // Default
	}

	// Check if force reprocess is requested
	forceReprocess := c.PostForm("force_reprocess") == "true"

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

	originalFormat := strings.TrimPrefix(ext, ".")

	// Get selected parser from registry
	selectedParser, err := h.parserRegistry.Get(parser.ParserType(parserTypeStr))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Parser %s not available: %v", parserTypeStr, err),
		})
		return
	}

	// Check format compatibility
	if !selectedParser.CanParse(originalFormat) {
		// If DOCX and parser doesn't support it, check if we have converter
		if originalFormat == "docx" && h.converter == nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("Parser %s does not support DOCX format and converter is not available", parserTypeStr),
			})
			return
		} else if originalFormat != "docx" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("Parser %s does not support %s format", parserTypeStr, originalFormat),
			})
			return
		}
		slog.Info("parser does not support DOCX, will convert to PDF",
			"parser_type", parserTypeStr,
			"request_id", requestID,
		)
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

	// Calculate file hash for deduplication
	// Read file content into memory to calculate hash
	fileBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read file"})
		return
	}

	// Calculate SHA256 hash
	hash := sha256.Sum256(fileBytes)
	fileHash := hex.EncodeToString(hash[:])
	fileSize := int64(len(fileBytes))

	slog.Debug("file hash calculated",
		"request_id", requestID,
		"file_hash", fileHash,
		"file_size", fileSize)

	// Check for duplicate files in the same tenant (skip if force reprocess)
	var existingContract *model.Contract
	if !forceReprocess {
		existingContract = h.store.FindByHash(tenant, fileHash)
	}

	// If the existing contract failed, we should not return it as a cached result.
	// Instead, we should allow re-processing.
	if existingContract != nil && existingContract.Status == model.StatusFailed {
		slog.Info("found existing contract but it failed, ignoring cache to allow retry",
			"request_id", requestID,
			"existing_contract_id", existingContract.ID,
			"file_hash", fileHash)
		existingContract = nil
	}

	if existingContract != nil {
		// File already exists - return existing result instead of reprocessing
		slog.Info("duplicate file detected, returning existing contract",
			"request_id", requestID,
			"tenant", tenant,
			"existing_contract_id", existingContract.ID,
			"file_hash", fileHash,
			"filename", header.Filename)

		// Increment duplicate count
		h.store.IncrementDuplicateCount(existingContract.ID)

		// Create a new contract record that references the original
		contractID := uuid.New().String()
		duplicateContract := &model.Contract{
			ID:               contractID,
			Filename:         header.Filename,
			Tenant:           tenant,
			OriginalFormat:   originalFormat,
			FileURL:          existingContract.FileURL,
			ConvertedFileURL: existingContract.ConvertedFileURL,
			FileHash:         fileHash,
			FileSize:         fileSize,
			ParserType:       existingContract.ParserType,
			Status:           existingContract.Status,
			IsDuplicate:      true,
			OriginalID:       existingContract.ID,
			JSONData:         existingContract.JSONData,
			RawJSONData:      existingContract.RawJSONData,
			Metadata:         existingContract.Metadata,
			CreatedAt:        time.Now(),
			UpdatedAt:        time.Now(),
		}

		h.store.Save(duplicateContract)

		c.JSON(http.StatusOK, gin.H{
			"id":           existingContract.ID,
			"filename":     duplicateContract.Filename,
			"status":       existingContract.Status,
			"is_duplicate": true,
			"original_id":  existingContract.ID,
			"message":      "File already processed, returning cached result",
		})
		return
	}

	// File is unique - proceed with upload
	// Create a reader from the bytes we already read
	fileReader := bytes.NewReader(fileBytes)

	// Generate unique ID and object name
	contractID := uuid.New().String()
	objectName := tenant + "/" + contractID + "/" + header.Filename

	slog.Info("uploading contract file",
		"request_id", requestID,
		"tenant", tenant,
		"contract_id", contractID,
		"filename", header.Filename,
		"size", fileSize,
		"parser_type", parserTypeStr,
		"file_hash", fileHash,
	)

	// Upload to MINIO using the bytes we already read
	err = h.minioService.UploadFile(c.Request.Context(), objectName, fileReader, fileSize, contentType)
	if err != nil {
		slog.Error("failed to upload file to MINIO",
			"request_id", requestID,
			"contract_id", contractID,
			"error", err,
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upload file: " + err.Error()})
		return
	}

	// Get presigned URL for parser
	fileURL, err := h.minioService.GetPresignedURL(c.Request.Context(), objectName)
	if err != nil {
		slog.Error("failed to generate presigned URL",
			"request_id", requestID,
			"contract_id", contractID,
			"error", err,
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate URL: " + err.Error()})
		return
	}

	// Create contract record with new fields
	contract := &model.Contract{
		ID:             contractID,
		Filename:       header.Filename,
		Tenant:         tenant,
		OriginalFormat: originalFormat,
		FileURL:        fileURL,
		PDFURL:         fileURL, // Backward compatibility
		FileHash:       fileHash,
		FileSize:       fileSize,
		ParserType:     parserTypeStr,
		Status:         model.StatusPending,
		Metadata:       &model.ContractMetadata{},
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	h.store.Save(contract)

	slog.Info("contract uploaded successfully",
		"request_id", requestID,
		"contract_id", contractID,
		"tenant", tenant,
		"parser_type", parserTypeStr,
	)

	traceID := timing.GetTraceID(c)
	if traceID == "" {
		traceID = uuid.New().String()
	}
	go h.processDocument(contract, selectedParser, traceID, requestID)

	c.JSON(http.StatusOK, gin.H{
		"id":          contractID,
		"filename":    header.Filename,
		"file_url":    fileURL,
		"status":      model.StatusPending,
		"parser_type": parserTypeStr,
	})
}

// processDocument handles document parsing asynchronously with DOCX conversion support
func (h *ContractHandler) processDocument(contract *model.Contract, selectedParser parser.DocumentParser, traceID, requestID string) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in processDocument",
				"contract_id", contract.ID,
				"trace_id", traceID,
				"panic", r,
			)
			h.store.UpdateStatus(contract.ID, model.StatusFailed, fmt.Sprintf("Internal error: %v", r))
		}
	}()

	ctx := context.Background()

	tracker := timing.NewAsyncTracker(
		traceID,
		requestID,
		contract.ID,
		contract.Tenant,
		"document_processing",
		h.timingConfig,
		h.timingAlerter,
	)
	defer tracker.Finish()

	slog.Info("starting document processing",
		"trace_id", traceID,
		"contract_id", contract.ID,
		"parser_type", contract.ParserType,
		"original_format", contract.OriginalFormat,
	)

	fileURLForParser := contract.FileURL
	if contract.OriginalFormat == "docx" && !selectedParser.CanParse("docx") {
		slog.Info("converting DOCX to PDF",
			"trace_id", traceID,
			"contract_id", contract.ID,
			"parser_type", contract.ParserType,
		)
		h.store.UpdateStatus(contract.ID, model.StatusConverting, "")

		var pdfContent []byte
		var conversionDuration time.Duration
		err := tracker.Track("docx_convert", func() error {
			conversionStart := time.Now()
			var err error
			pdfContent, err = h.converter.ConvertDOCXFromURL(ctx, contract.FileURL)
			conversionDuration = time.Since(conversionStart)
			return err
		})
		if err != nil {
			slog.Error("DOCX conversion failed",
				"trace_id", traceID,
				"contract_id", contract.ID,
				"error", err,
			)
			h.store.UpdateStatus(contract.ID, model.StatusFailed, "DOCX conversion failed: "+err.Error())
			return
		}

		pdfObjectName := contract.Tenant + "/" + contract.ID + "/converted.pdf"
		err = tracker.Track("upload_converted_pdf", func() error {
			return h.minioService.UploadFile(ctx, pdfObjectName,
				io.NopCloser(bytes.NewReader(pdfContent)), int64(len(pdfContent)), "application/pdf")
		})
		if err != nil {
			slog.Error("failed to save converted PDF",
				"trace_id", traceID,
				"contract_id", contract.ID,
				"error", err,
			)
			h.store.UpdateStatus(contract.ID, model.StatusFailed, "Failed to save converted PDF: "+err.Error())
			return
		}

		pdfURL, err := h.minioService.GetPresignedURL(ctx, pdfObjectName)
		if err != nil {
			slog.Error("failed to generate PDF URL",
				"trace_id", traceID,
				"contract_id", contract.ID,
				"error", err,
			)
			h.store.UpdateStatus(contract.ID, model.StatusFailed, "Failed to generate PDF URL: "+err.Error())
			return
		}

		fileURLForParser = pdfURL
		contract.ConvertedFileURL = pdfURL
		contract.Metadata.ConvertedFromDOCX = true
		contract.Metadata.ConversionDuration = conversionDuration.Milliseconds()
		h.store.Save(contract)

		slog.Info("DOCX conversion completed",
			"trace_id", traceID,
			"contract_id", contract.ID,
			"duration_ms", conversionDuration.Milliseconds(),
		)
	}

	h.store.UpdateStatus(contract.ID, model.StatusProcessing, "")

	var taskID string
	err := tracker.Track("create_task", func() error {
		var err error
		taskID, err = selectedParser.CreateTask(ctx, fileURLForParser, contract.ID)
		return err
	})
	if err != nil {
		slog.Error("failed to create parser task",
			"trace_id", traceID,
			"contract_id", contract.ID,
			"parser_type", contract.ParserType,
			"error", err,
		)
		h.store.UpdateStatus(contract.ID, model.StatusFailed, "Failed to start parsing: "+err.Error())
		return
	}

	slog.Info("parser task created",
		"trace_id", traceID,
		"contract_id", contract.ID,
		"parser_type", contract.ParserType,
		"task_id", taskID,
	)

	contract.TaskID = taskID
	contract.MineruTaskID = taskID
	h.store.Save(contract)

	h.pollParserTask(contract, selectedParser, tracker, traceID)
}

// pollParserTask polls for task completion (generic for all parsers)
func (h *ContractHandler) pollParserTask(contract *model.Contract, selectedParser parser.DocumentParser, tracker *timing.Tracker, traceID string) {
	ctx := context.Background()
	maxAttempts := 60
	interval := 5 * time.Second

	slog.Info("starting task polling",
		"trace_id", traceID,
		"contract_id", contract.ID,
		"task_id", contract.TaskID,
		"parser_type", contract.ParserType,
	)

	pollStart := time.Now()
	var resultURL string
	var finalState string
	var lastStatus *parser.TaskStatus

	for i := 0; i < maxAttempts; i++ {
		time.Sleep(interval)

		status, err := selectedParser.GetTaskStatus(ctx, contract.TaskID)
		if err != nil {
			slog.Warn("poll attempt failed",
				"trace_id", traceID,
				"contract_id", contract.ID,
				"task_id", contract.TaskID,
				"parser_type", contract.ParserType,
				"attempt", i+1,
				"max_attempts", maxAttempts,
				"error", err,
			)
			continue
		}
		lastStatus = status

		slog.Debug("poll status",
			"trace_id", traceID,
			"contract_id", contract.ID,
			"task_id", contract.TaskID,
			"attempt", i+1,
			"state", status.State,
			"status_context", buildParserStatusContext(status),
		)

		switch status.State {
		case "done", "completed", "success":
			resultURL = status.ResultURL
			finalState = status.State
			tracker.Record("polling", time.Since(pollStart))
			goto fetchResult

		case "failed", "error":
			tracker.Record("polling", time.Since(pollStart))
			failureMessage := buildParserFailureMessage(status)
			slog.Error("parser task failed",
				"trace_id", traceID,
				"contract_id", contract.ID,
				"task_id", contract.TaskID,
				"parser_type", contract.ParserType,
				"attempt", i+1,
				"error_msg", failureMessage,
				"status_context", buildParserStatusContext(status),
			)
			h.store.UpdateStatus(contract.ID, model.StatusFailed, failureMessage)
			return
		}
	}

	tracker.Record("polling", time.Since(pollStart))
	slog.Error("task polling timeout",
		"trace_id", traceID,
		"contract_id", contract.ID,
		"task_id", contract.TaskID,
		"parser_type", contract.ParserType,
		"attempts", maxAttempts,
		"last_status_context", buildParserStatusContext(lastStatus),
	)
	h.store.UpdateStatus(contract.ID, model.StatusFailed, buildParserTimeoutMessage(lastStatus, maxAttempts))
	return

fetchResult:
	slog.Info("task completed, fetching result",
		"trace_id", traceID,
		"contract_id", contract.ID,
		"state", finalState,
		"result_url", resultURL,
	)

	var rawData map[string]interface{}
	var pdfData []byte

	if mineruParser, ok := selectedParser.(*parser.MineruParser); ok {
		err := tracker.Track("fetch_result", func() error {
			result, err := mineruParser.FetchResultWithPDF(ctx, resultURL)
			if err != nil {
				return err
			}
			rawData = result.JSONData
			pdfData = result.PDFData
			return nil
		})
		if err != nil {
			slog.Error("failed to fetch result with PDF",
				"trace_id", traceID,
				"contract_id", contract.ID,
				"error", err,
			)
			h.store.UpdateStatus(contract.ID, model.StatusFailed, "Failed to fetch result: "+err.Error())
			return
		}

		if len(pdfData) > 0 && contract.ConvertedFileURL == "" {
			pdfObjectName := fmt.Sprintf("%s/%s/layout.pdf", contract.Tenant, contract.ID)
			pdfURL, err := h.minioService.UploadBytes(ctx, pdfObjectName, pdfData, "application/pdf")
			if err != nil {
				slog.Warn("failed to upload extracted PDF, continuing without it",
					"trace_id", traceID,
					"contract_id", contract.ID,
					"error", err,
				)
			} else {
				contract.ConvertedFileURL = pdfURL
				slog.Info("uploaded extracted PDF from MinerU",
					"trace_id", traceID,
					"contract_id", contract.ID,
					"pdf_url", pdfURL,
					"pdf_size", len(pdfData),
				)
			}
		}
	} else {
		err := tracker.Track("fetch_result", func() error {
			var err error
			rawData, err = selectedParser.FetchResult(ctx, contract.TaskID, resultURL)
			return err
		})
		if err != nil {
			slog.Error("failed to fetch result",
				"trace_id", traceID,
				"contract_id", contract.ID,
				"error", err,
			)
			h.store.UpdateStatus(contract.ID, model.StatusFailed, "Failed to fetch result: "+err.Error())
			return
		}
	}

	var normalizedData map[string]interface{}
	err := tracker.Track("normalize", func() error {
		var err error
		normalizedData, err = selectedParser.NormalizeResult(rawData)
		return err
	})
	if err != nil {
		slog.Error("failed to normalize result",
			"trace_id", traceID,
			"contract_id", contract.ID,
			"error", err,
		)
		h.store.UpdateStatus(contract.ID, model.StatusFailed, "Failed to normalize result: "+err.Error())
		return
	}

	processingDuration := tracker.TotalDuration()
	contract.Metadata.ProcessingDuration = processingDuration.Milliseconds()

	contract.JSONData = normalizedData
	contract.RawJSONData = rawData
	contract.Status = model.StatusCompleted
	contract.UpdatedAt = time.Now()
	h.store.Save(contract)

	slog.Info("document processing completed",
		"trace_id", traceID,
		"contract_id", contract.ID,
		"total_duration_ms", processingDuration.Milliseconds(),
		"parser_type", contract.ParserType,
		"has_pdf", contract.ConvertedFileURL != "",
	)
}

func buildParserFailureMessage(status *parser.TaskStatus) string {
	if status == nil {
		return "Parser task failed"
	}

	if strings.TrimSpace(status.ErrorMessage) != "" {
		return status.ErrorMessage
	}

	context := buildParserStatusContext(status)
	if state, ok := context["state"].(string); ok && state != "" {
		return fmt.Sprintf("Parser task failed (state=%s)", state)
	}

	return "Parser task failed"
}

func buildParserTimeoutMessage(status *parser.TaskStatus, attempts int) string {
	message := fmt.Sprintf("Task polling timeout after %d attempts", attempts)
	context := buildParserStatusContext(status)
	if len(context) == 0 {
		return message
	}

	parts := make([]string, 0, 5)
	if state, ok := context["state"].(string); ok && strings.TrimSpace(state) != "" {
		parts = append(parts, "last state="+state)
	}
	for _, key := range []string{"api_message", "data_id", "task_id", "trace_id"} {
		if value, ok := context[key]; ok && value != nil && fmt.Sprint(value) != "" {
			parts = append(parts, fmt.Sprintf("%s=%v", key, value))
		}
	}
	if len(parts) == 0 {
		return message
	}

	return fmt.Sprintf("%s (%s)", message, strings.Join(parts, ", "))
}

func buildParserStatusContext(status *parser.TaskStatus) map[string]interface{} {
	if status == nil {
		return nil
	}

	context := map[string]interface{}{
		"state": status.State,
	}
	if status.ResultURL != "" {
		context["result_url"] = status.ResultURL
	}
	if status.ErrorMessage != "" {
		context["error_message"] = status.ErrorMessage
	}
	if status.Progress != nil {
		context["progress"] = map[string]interface{}{
			"processed_pages": status.Progress.ProcessedPages,
			"total_pages":     status.Progress.TotalPages,
		}
		if !status.Progress.StartTime.IsZero() {
			context["progress_start_time"] = status.Progress.StartTime.Format(time.RFC3339)
		}
	}
	if status.RawData == nil {
		return context
	}

	for _, key := range []string{"trace_id", "task_id", "data_id", "model_version", "api_message"} {
		if value, ok := status.RawData[key]; ok && value != nil && value != "" {
			context[key] = value
		}
	}
	if progress, ok := status.RawData["extract_progress"]; ok && progress != nil {
		context["extract_progress"] = progress
	}

	return context
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
	requestID := middleware.GetRequestID(c)

	contract := h.store.Get(id)
	if contract == nil || contract.Tenant != tenant {
		c.JSON(http.StatusNotFound, gin.H{"error": "Contract not found"})
		return
	}

	h.store.Delete(id)

	slog.Info("contract deleted",
		"request_id", requestID,
		"contract_id", id,
		"tenant", tenant,
	)

	c.JSON(http.StatusOK, gin.H{"message": "Contract deleted"})
}

func (h *ContractHandler) GetPDF(c *gin.Context) {
	tenant := middleware.GetTenant(c)
	id := c.Param("id")

	contract := h.store.Get(id)
	if contract == nil || contract.Tenant != tenant {
		c.JSON(http.StatusNotFound, gin.H{"error": "Contract not found"})
		return
	}

	pdfURL := contract.GetPDFURL()
	if pdfURL == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "PDF not available"})
		return
	}

	resp, err := h.httpClient.Get(c.Request.Context(), pdfURL)
	if err != nil {
		slog.Error("failed to fetch PDF",
			"contract_id", id,
			"error", err,
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch PDF"})
		return
	}

	if resp.StatusCode() != http.StatusOK {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch PDF from storage"})
		return
	}

	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=\"%s.pdf\"", contract.ID))

	_, err = c.Writer.Write(resp.Body())
	if err != nil {
		slog.Error("failed to write PDF",
			"contract_id", id,
			"error", err,
		)
	}
}

// ReNormalize re-processes the raw_json_data using the current parser logic
func (h *ContractHandler) ReNormalize(c *gin.Context) {
	tenant := middleware.GetTenant(c)
	id := c.Param("id")
	requestID := middleware.GetRequestID(c)

	contract := h.store.Get(id)
	if contract == nil || contract.Tenant != tenant {
		c.JSON(http.StatusNotFound, gin.H{"error": "Contract not found"})
		return
	}

	rawData, ok := contract.RawJSONData.(map[string]interface{})
	if !ok || rawData == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No raw data available for re-normalization"})
		return
	}

	selectedParser, err := h.parserRegistry.Get(parser.ParserType(contract.ParserType))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Parser %s not available", contract.ParserType)})
		return
	}

	normalizedData, err := selectedParser.NormalizeResult(rawData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to normalize data"})
		return
	}

	contract.JSONData = normalizedData
	h.store.Save(contract)

	slog.Info("contract re-normalized",
		"request_id", requestID,
		"contract_id", id,
		"parser_type", contract.ParserType,
	)

	c.JSON(http.StatusOK, gin.H{
		"message":     "Re-normalization completed",
		"contract_id": id,
	})
}

// InvalidateCache clears the cache for a specific contract to allow reprocessing
func (h *ContractHandler) InvalidateCache(c *gin.Context) {
	tenant := middleware.GetTenant(c)
	id := c.Param("id")
	requestID := middleware.GetRequestID(c)

	contract := h.store.Get(id)
	if contract == nil || contract.Tenant != tenant {
		c.JSON(http.StatusNotFound, gin.H{"error": "Contract not found"})
		return
	}

	if contract.FileHash == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Contract has no file hash"})
		return
	}

	h.store.InvalidateCache(tenant, contract.FileHash)

	slog.Info("cache invalidated",
		"request_id", requestID,
		"contract_id", id,
		"tenant", tenant,
		"file_hash", contract.FileHash,
	)

	c.JSON(http.StatusOK, gin.H{
		"message":   "Cache invalidated successfully",
		"file_hash": contract.FileHash,
	})
}
