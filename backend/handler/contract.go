package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"math"
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
	"github.com/AnTengye/contractdiff/backend/service/pdfcheck"
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
	parseSlots     chan struct{}
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
		parseSlots:     make(chan struct{}, 4),
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

	// DOCX always follows the canonical conversion path and is then submitted
	// to MinerU as PDF. A missing converter disables only Word uploads; PDF
	// uploads continue to use the selected parser.
	var selectedParser parser.DocumentParser
	if originalFormat == "docx" {
		if h.converter == nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "DOCX upload is unavailable because the PDF conversion service is not configured; PDF upload remains available",
			})
			return
		}
		parserTypeStr = string(parser.ParserTypeMinerU)
		selectedParser, err = h.parserRegistry.Get(parser.ParserTypeMinerU)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "DOCX upload requires the MinerU PDF parser, which is not available",
			})
			return
		}
	} else {
		selectedParser, err = h.parserRegistry.Get(parser.ParserType(parserTypeStr))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("Parser %s not available: %v", parserTypeStr, err),
			})
			return
		}
		if !selectedParser.CanParse("pdf") {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("Parser %s does not support PDF format", parserTypeStr),
			})
			return
		}
	}
	identity := parser.ParserIdentity(selectedParser)
	conversionRevision := ""
	if originalFormat == "docx" {
		conversionRevision = h.converter.Revision()
	}
	processingSignature := parser.ProcessingSignature(originalFormat, identity, conversionRevision)

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
	fileLimit := selectedParser.GetCapabilities().MaxFileSize
	if fileLimit <= 0 {
		fileLimit = 50 << 20
	}
	fileBytes, err := io.ReadAll(io.LimitReader(file, fileLimit+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read file"})
		return
	}
	if int64(len(fileBytes)) > fileLimit {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "File exceeds parser size limit"})
		return
	}

	var inputPDFInfo pdfcheck.Info
	if originalFormat == "pdf" {
		inputPDFInfo, err = pdfcheck.Validate(fileBytes, pdfcheck.Options{MaxBytes: fileLimit})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid PDF: " + err.Error()})
			return
		}
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
		existingContract = h.store.FindParsedPipeline(tenant, fileHash, processingSignature)
		if existingContract != nil && !h.cachePDFUsable(c.Request.Context(), existingContract, fileLimit) {
			slog.Info("cached result failed canonical PDF integrity check, rebuilding",
				"request_id", requestID,
				"existing_contract_id", existingContract.ID,
				"file_hash", fileHash,
			)
			existingContract = nil
		}
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

		c.JSON(http.StatusOK, gin.H{
			"id":           existingContract.ID,
			"filename":     header.Filename,
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
		ID:                   contractID,
		Filename:             header.Filename,
		Tenant:               tenant,
		OriginalFormat:       originalFormat,
		FileURL:              fileURL,
		FileHash:             fileHash,
		FileSize:             fileSize,
		ParserType:           parserTypeStr,
		ParserVersion:        identity.Version,
		ParserSignature:      identity.Signature,
		ProcessingSignature:  processingSignature,
		ConversionRevision:   conversionRevision,
		ParserSettings:       identity.Settings,
		NormalizationVersion: parser.NormalizationVersion,
		FileObjectKey:        objectName,
		RequestID:            requestID,
		Status:               model.StatusPending,
		Metadata:             &model.ContractMetadata{},
		CreatedAt:            time.Now(),
		UpdatedAt:            time.Now(),
	}
	if originalFormat == "pdf" {
		contract.PDFURL = fileURL
		contract.PDFHash = inputPDFInfo.SHA256
		contract.PDFObjectKey = objectName
		contract.Metadata.PageCount = inputPDFInfo.PageCount
		contract.Metadata.PDFPages = toModelPDFPages(inputPDFInfo)
		contract.ResultSignature = parser.ResultSignature(contract.PDFHash, processingSignature)
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
			h.store.UpdateFailure(contract.ID, "processing", fmt.Sprintf("Internal error: %v", r))
		}
	}()

	ctx := context.Background()
	contract.TraceID = traceID

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
	if h.parseSlots != nil {
		queueStart := time.Now()
		h.parseSlots <- struct{}{}
		defer func() { <-h.parseSlots }()
		tracker.Record("queue_wait", time.Since(queueStart))
	}

	slog.Info("starting document processing",
		"trace_id", traceID,
		"contract_id", contract.ID,
		"parser_type", contract.ParserType,
		"original_format", contract.OriginalFormat,
	)

	fileURLForParser := contract.FileURL
	if contract.OriginalFormat == "docx" {
		if h.converter == nil {
			h.store.UpdateFailure(contract.ID, "conversion", "DOCX conversion service is not configured")
			return
		}
		slog.Info("converting DOCX to PDF",
			"trace_id", traceID,
			"contract_id", contract.ID,
			"parser_type", contract.ParserType,
		)
		if !h.store.UpdateStatusIfNotTerminal(contract.ID, model.StatusConverting, "") {
			return
		}
		contract.Status = model.StatusConverting

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
			h.store.UpdateFailure(contract.ID, "conversion", "DOCX conversion failed: "+err.Error())
			return
		}

		pdfInfo, err := pdfcheck.Validate(pdfContent, pdfcheck.Options{
			MaxBytes:    selectedParser.GetCapabilities().MaxFileSize,
			RequireText: true,
		})
		if err != nil {
			slog.Error("converted DOCX is not a readable PDF",
				"trace_id", traceID,
				"contract_id", contract.ID,
				"error", err,
			)
			h.store.UpdateFailure(contract.ID, "conversion", "Converted DOCX PDF validation failed: "+err.Error())
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
			h.store.UpdateFailure(contract.ID, "conversion", "Failed to save converted PDF: "+err.Error())
			return
		}

		pdfURL, err := h.minioService.GetPresignedURL(ctx, pdfObjectName)
		if err != nil {
			slog.Error("failed to generate PDF URL",
				"trace_id", traceID,
				"contract_id", contract.ID,
				"error", err,
			)
			h.store.UpdateFailure(contract.ID, "conversion", "Failed to generate PDF URL: "+err.Error())
			return
		}

		fileURLForParser = pdfURL
		contract.ConvertedFileURL = pdfURL
		contract.PDFURL = pdfURL
		contract.PDFHash = pdfInfo.SHA256
		contract.PDFObjectKey = pdfObjectName
		contract.ResultSignature = parser.ResultSignature(contract.PDFHash, contract.ProcessingSignature)
		contract.Metadata.ConvertedFromDOCX = true
		contract.Metadata.ConversionDuration = conversionDuration.Milliseconds()
		contract.Metadata.PageCount = pdfInfo.PageCount
		contract.Metadata.PDFPages = toModelPDFPages(pdfInfo)
		if !h.store.SaveIfNotTerminal(contract) {
			slog.Warn("conversion snapshot was superseded by a terminal state", "contract_id", contract.ID)
			return
		}

		slog.Info("DOCX conversion completed",
			"trace_id", traceID,
			"contract_id", contract.ID,
			"duration_ms", conversionDuration.Milliseconds(),
		)
	}

	if !selectedParser.CanParse("pdf") {
		h.store.UpdateFailure(contract.ID, "parser", fmt.Sprintf("Parser %s does not support PDF input", contract.ParserType))
		return
	}
	if contract.OriginalFormat == "pdf" {
		fileURLForParser = contract.GetPDFURL()
	}
	if fileURLForParser == "" {
		h.store.UpdateFailure(contract.ID, "preview", "No validated PDF is available for parsing")
		return
	}

	if !h.store.UpdateStatusIfNotTerminal(contract.ID, model.StatusProcessing, "") {
		return
	}
	contract.Status = model.StatusProcessing

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
		h.store.UpdateFailure(contract.ID, "parser", "Failed to start parsing: "+err.Error())
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
	h.store.UpdateTaskID(contract.ID, taskID)

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
		if i > 0 {
			time.Sleep(interval)
		}

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
			h.store.UpdateFailure(contract.ID, "parser", failureMessage)
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
	h.store.UpdateFailure(contract.ID, "parser", buildParserTimeoutMessage(lastStatus, maxAttempts))
	return

fetchResult:
	slog.Info("task completed, fetching result",
		"trace_id", traceID,
		"contract_id", contract.ID,
		"state", finalState,
		"result_url", resultURL,
	)

	var rawData map[string]interface{}
	err := tracker.Track("fetch_result", func() error {
		var err error
		rawData, err = selectedParser.FetchResult(ctx, contract.TaskID, resultURL)
		return err
	})
	if err != nil {
		slog.Error("failed to fetch parser result",
			"trace_id", traceID,
			"contract_id", contract.ID,
			"error", err,
		)
		h.store.UpdateFailure(contract.ID, "parser", "Failed to fetch result: "+err.Error())
		return
	}
	if rawData == nil {
		h.store.UpdateFailure(contract.ID, "parser", "Parser returned an empty result")
		return
	}

	contract.RawJSONData = rawData
	if !h.store.SaveIfNotTerminal(contract) {
		slog.Warn("parser result was superseded by a terminal state", "contract_id", contract.ID)
		return
	}
	var normalizedData map[string]interface{}
	err = tracker.Track("normalize", func() error {
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
		h.store.UpdateFailure(contract.ID, "normalization", "Failed to normalize result: "+err.Error())
		return
	}

	coordinateStatus, coordinateWarnings := validateNormalizedCoordinates(normalizedData, contract.Metadata.PDFPages)
	contract.CoordinateStatus = coordinateStatus
	contract.CoordinateWarnings = coordinateWarnings
	attachCanonicalPDFMetadata(normalizedData, contract)

	processingDuration := tracker.TotalDuration()
	contract.Metadata.ProcessingDuration = processingDuration.Milliseconds()
	contract.Metadata.Steps = map[string]int64{}
	for _, step := range tracker.Steps() {
		contract.Metadata.Steps[step.Name] = step.Duration.Milliseconds()
	}

	contract.JSONData = normalizedData
	contract.RawJSONData = rawData
	contract.Status = model.StatusCompleted
	contract.FailureStage = ""
	contract.ErrorMsg = ""
	contract.UpdatedAt = time.Now()
	if !h.store.SaveIfNotTerminal(contract) {
		slog.Warn("completed result was superseded by a terminal state", "contract_id", contract.ID)
		return
	}

	slog.Info("document processing completed",
		"trace_id", traceID,
		"contract_id", contract.ID,
		"total_duration_ms", processingDuration.Milliseconds(),
		"parser_type", contract.ParserType,
		"has_pdf", contract.PDFObjectKey != "" || contract.GetPDFURL() != "",
	)
}

func toModelPDFPages(info pdfcheck.Info) []model.PDFPageMetadata {
	pages := make([]model.PDFPageMetadata, 0, len(info.Pages))
	for _, page := range info.Pages {
		pages = append(pages, model.PDFPageMetadata{
			PageIdx:  page.Index,
			Width:    page.Width,
			Height:   page.Height,
			Rotation: page.Rotation,
			CropBox:  page.CropBox,
		})
	}
	return pages
}

func (h *ContractHandler) cachePDFUsable(ctx context.Context, contract *model.Contract, maxBytes int64) bool {
	if contract == nil || contract.Status != model.StatusCompleted || contract.JSONData == nil ||
		contract.ProcessingSignature == "" || contract.PDFHash == "" || contract.ResultSignature == "" {
		return false
	}
	if contract.ResultSignature != parser.ResultSignature(contract.PDFHash, contract.ProcessingSignature) {
		return false
	}
	_, info, err := h.loadCanonicalPDF(ctx, contract, maxBytes)
	return err == nil && info.SHA256 == contract.PDFHash
}

func (h *ContractHandler) loadCanonicalPDF(ctx context.Context, contract *model.Contract, maxBytes int64) ([]byte, pdfcheck.Info, error) {
	if contract == nil {
		return nil, pdfcheck.Info{}, fmt.Errorf("contract is missing")
	}
	if maxBytes <= 0 {
		maxBytes = pdfcheck.DefaultMaxBytes
	}

	key := contract.PDFObjectKey
	if key == "" && contract.OriginalFormat == "pdf" {
		// This is the only legacy fallback retained: an original PDF object is
		// still a possible canonical PDF after structural validation. A DOCX
		// object is never accepted here.
		key = contract.FileObjectKey
	}
	if key != "" {
		if h.minioService == nil {
			return nil, pdfcheck.Info{}, fmt.Errorf("PDF storage is unavailable")
		}
		reader, contentType, err := h.minioService.OpenFile(ctx, key)
		if err != nil {
			return nil, pdfcheck.Info{}, fmt.Errorf("failed to fetch PDF object: %w", err)
		}
		defer reader.Close()
		if !isPDFContentType(contentType) {
			return nil, pdfcheck.Info{}, fmt.Errorf("PDF object has content type %q", contentType)
		}
		data, err := readLimitedBytes(reader, maxBytes)
		if err != nil {
			return nil, pdfcheck.Info{}, err
		}
		info, err := validateCanonicalPDF(data, contract.PDFHash, maxBytes)
		return data, info, err
	}

	pdfURL := contract.GetPDFURL()
	if pdfURL == "" {
		return nil, pdfcheck.Info{}, fmt.Errorf("PDF object is not recorded")
	}
	if h.httpClient == nil {
		return nil, pdfcheck.Info{}, fmt.Errorf("PDF HTTP client is unavailable")
	}
	resp, err := h.httpClient.R(ctx).SetResponseBodyLimit(int(maxBytes)).Get(pdfURL)
	if err != nil {
		return nil, pdfcheck.Info{}, fmt.Errorf("failed to fetch PDF URL: %w", err)
	}
	if resp.StatusCode() != http.StatusOK {
		return nil, pdfcheck.Info{}, fmt.Errorf("PDF URL returned status %d", resp.StatusCode())
	}
	if !isPDFContentType(resp.Header().Get("Content-Type")) {
		return nil, pdfcheck.Info{}, fmt.Errorf("PDF URL returned content type %q", resp.Header().Get("Content-Type"))
	}
	data := resp.Body()
	info, err := validateCanonicalPDF(data, contract.PDFHash, maxBytes)
	return data, info, err
}

func validateCanonicalPDF(data []byte, expectedHash string, maxBytes int64) (pdfcheck.Info, error) {
	info, err := pdfcheck.Validate(data, pdfcheck.Options{MaxBytes: maxBytes})
	if err != nil {
		return pdfcheck.Info{}, err
	}
	if expectedHash != "" && info.SHA256 != expectedHash {
		return pdfcheck.Info{}, fmt.Errorf("PDF SHA256 does not match the recorded canonical PDF")
	}
	return info, nil
}

func readLimitedBytes(reader io.Reader, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		maxBytes = pdfcheck.DefaultMaxBytes
	}
	data, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("failed to read PDF: %w", err)
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("PDF exceeds maximum size of %d bytes", maxBytes)
	}
	return data, nil
}

func isPDFContentType(contentType string) bool {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	return contentType == "" || contentType == "application/pdf" || contentType == "application/octet-stream"
}

type coordinateStats struct {
	textBlocks int
	located    int
	invalid    int
}

// validateNormalizedCoordinates verifies parser coordinates against the
// canonical PDF geometry. Missing coordinates are reported as a degraded
// result; they are never inferred from text position or page order.
func validateNormalizedCoordinates(data map[string]interface{}, pages []model.PDFPageMetadata) (string, []string) {
	warnings := []string{}
	if len(pages) == 0 {
		return "unavailable", []string{"解析输入 PDF 没有可用的页面几何信息"}
	}

	metadata, _ := data["metadata"].(map[string]interface{})
	if pageCount, ok := numberValue(metadata["page_count"]); ok && int(pageCount) != len(pages) {
		warnings = append(warnings, fmt.Sprintf("解析结果页数 %d 与解析输入 PDF 页数 %d 不一致", int(pageCount), len(pages)))
	}
	if sizes, ok := metadata["page_sizes"].([]interface{}); ok {
		for index, value := range sizes {
			size, ok := value.(map[string]interface{})
			if !ok {
				continue
			}
			pageIndex := index
			if n, ok := numberValue(size["page_idx"]); ok {
				pageIndex = int(n)
			}
			if pageIndex < 0 || pageIndex >= len(pages) {
				warnings = append(warnings, "解析结果包含超出 PDF 页数的页面尺寸")
				continue
			}
			width, widthOK := numberValue(size["width"])
			height, heightOK := numberValue(size["height"])
			if widthOK && heightOK && (math.Abs(width-pages[pageIndex].Width) > 2 || math.Abs(height-pages[pageIndex].Height) > 2) {
				warnings = append(warnings, fmt.Sprintf("解析结果第 %d 页尺寸与预览 PDF 不一致", pageIndex+1))
			}
		}
	}

	stats := coordinateStats{}
	for _, key := range []string{"paragraphs", "tables", "images"} {
		if values, ok := data[key].([]interface{}); ok {
			for _, value := range values {
				walkCoordinateNode(value, -1, nil, pages, &stats)
			}
		}
	}
	if stats.invalid > 0 {
		warnings = append(warnings, "部分解析文本缺少坐标或坐标超出 PDF 页面范围，相关差异无法定位")
	}
	if stats.textBlocks == 0 {
		warnings = append(warnings, "解析结果没有可定位文本")
		return "unavailable", uniqueStrings(warnings)
	}
	if stats.located == 0 {
		return "unavailable", uniqueStrings(warnings)
	}
	if stats.invalid > 0 || len(warnings) > 0 {
		return "partial", uniqueStrings(warnings)
	}
	return "complete", nil
}

func walkCoordinateNode(value interface{}, parentPage int, inherited []float64, pages []model.PDFPageMetadata, stats *coordinateStats) {
	node, ok := value.(map[string]interface{})
	if !ok {
		return
	}
	page := parentPage
	if n, ok := numberValue(node["page"]); ok {
		page = int(n) - 1
	} else if n, ok := numberValue(node["page_idx"]); ok {
		page = int(n)
	}
	var box []float64
	if parsedBox, hasBox := bboxValue(node["bbox"]); hasBox {
		box = *parsedBox
	} else {
		box = inherited
	}

	if cells, ok := node["cells"].([]interface{}); ok {
		for _, cell := range cells {
			walkCoordinateNode(cell, page, box, pages, stats)
		}
		return
	}
	if blocks, ok := node["blocks"].([]interface{}); ok && len(blocks) > 0 {
		for _, block := range blocks {
			walkCoordinateNode(block, page, box, pages, stats)
		}
		return
	}
	if lines, ok := node["lines"].([]interface{}); ok && len(lines) > 0 {
		for _, line := range lines {
			walkCoordinateNode(line, page, box, pages, stats)
		}
		return
	}
	if spans, ok := node["spans"].([]interface{}); ok && len(spans) > 0 {
		for _, span := range spans {
			walkCoordinateNode(span, page, box, pages, stats)
		}
		return
	}

	text := stringValue(node["text"])
	if text == "" {
		text = stringValue(node["content"])
	}
	if strings.TrimSpace(text) == "" {
		return
	}
	stats.textBlocks++
	if page < 0 || page >= len(pages) || box == nil || !validBBox(box, pages[page]) {
		stats.invalid++
		return
	}
	stats.located++
}

func numberValue(value interface{}) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, !math.IsNaN(number) && !math.IsInf(number, 0)
	case float32:
		return float64(number), !math.IsNaN(float64(number)) && !math.IsInf(float64(number), 0)
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	default:
		return 0, false
	}
}

func stringValue(value interface{}) string {
	text, _ := value.(string)
	return text
}

func bboxValue(value interface{}) (*[]float64, bool) {
	var raw []interface{}
	switch bbox := value.(type) {
	case []interface{}:
		raw = bbox
	case []float64:
		if len(bbox) != 4 {
			return nil, false
		}
		copy := append([]float64(nil), bbox...)
		return &copy, true
	case [4]float64:
		copy := []float64{bbox[0], bbox[1], bbox[2], bbox[3]}
		return &copy, true
	default:
		return nil, false
	}
	if len(raw) != 4 {
		return nil, false
	}
	result := make([]float64, 4)
	for index, value := range raw {
		number, ok := numberValue(value)
		if !ok {
			return nil, false
		}
		result[index] = number
	}
	return &result, true
}

func validBBox(bbox []float64, page model.PDFPageMetadata) bool {
	if len(bbox) != 4 || !finiteNumbers(bbox) || bbox[2] < bbox[0] || bbox[3] < bbox[1] {
		return false
	}
	return bbox[0] >= -1 && bbox[1] >= -1 && bbox[2] <= page.Width+1 && bbox[3] <= page.Height+1
}

func finiteNumbers(values []float64) bool {
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func attachCanonicalPDFMetadata(data map[string]interface{}, contract *model.Contract) {
	if data == nil || contract == nil {
		return
	}
	metadata, _ := data["metadata"].(map[string]interface{})
	if metadata == nil {
		metadata = map[string]interface{}{}
		data["metadata"] = metadata
	}
	if contract.Metadata == nil {
		return
	}
	if parserPageCount, ok := numberValue(metadata["page_count"]); ok {
		metadata["parser_page_count"] = int(parserPageCount)
	}
	metadata["pdf_hash"] = contract.PDFHash
	metadata["processing_signature"] = contract.ProcessingSignature
	metadata["result_signature"] = contract.ResultSignature
	metadata["page_count"] = len(contract.Metadata.PDFPages)
	metadata["pdf_pages"] = make([]interface{}, 0, len(contract.Metadata.PDFPages))
	for _, page := range contract.Metadata.PDFPages {
		metadata["pdf_pages"] = append(metadata["pdf_pages"].([]interface{}), map[string]interface{}{
			"page_idx": page.PageIdx,
			"width":    page.Width,
			"height":   page.Height,
			"rotation": page.Rotation,
			"crop_box": page.CropBox,
		})
	}
	metadata["coordinate_status"] = contract.CoordinateStatus
	metadata["coordinate_warnings"] = append([]string(nil), contract.CoordinateWarnings...)
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
			"pdf_url":    contract.GetPDFURL(),
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

	if c.Query("include_raw") != "true" {
		contract.RawJSONData = nil
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
		"id":                  contract.ID,
		"status":              contract.Status,
		"error_msg":           contract.ErrorMsg,
		"failure_stage":       contract.FailureStage,
		"coordinate_status":   contract.CoordinateStatus,
		"coordinate_warnings": contract.CoordinateWarnings,
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

	pdfData, _, err := h.loadCanonicalPDF(c.Request.Context(), contract, pdfcheck.DefaultMaxBytes)
	if err != nil {
		slog.Error("failed to validate PDF preview",
			"contract_id", id,
			"error", err,
		)
		c.Header("X-Contract-Failure-Stage", "preview")
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "PDF preview validation failed: " + err.Error()})
		return
	}

	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=\"%s.pdf\"", contract.ID))
	if _, err := c.Writer.Write(pdfData); err != nil {
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
	contract.NormalizationVersion = parser.NormalizationVersion
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
