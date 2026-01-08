package converter

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
)

// GotenbergConverter handles DOCX to PDF conversion using Gotenberg
type GotenbergConverter struct {
	config     *config.GotenbergConfig
	httpClient *http.Client
}

// NewGotenbergConverter creates a new Gotenberg converter instance
func NewGotenbergConverter(cfg *config.GotenbergConfig) (*GotenbergConverter, error) {
	if cfg == nil || !cfg.Enabled {
		return nil, fmt.Errorf("Gotenberg converter not enabled")
	}

	timeout := time.Duration(cfg.Timeout) * time.Second
	if timeout == 0 {
		timeout = 60 * time.Second
	}

	return &GotenbergConverter{
		config: cfg,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}, nil
}

// ConvertDOCXToPDF converts a DOCX file to PDF
// fileContent is the DOCX file data
// filename is the name of the file (e.g., "document.docx")
// Returns the PDF file data
func (c *GotenbergConverter) ConvertDOCXToPDF(ctx context.Context, fileContent []byte, filename string) ([]byte, error) {
	// Create multipart form
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Add file to the form
	part, err := writer.CreateFormFile("files", filename)
	if err != nil {
		return nil, fmt.Errorf("failed to create form file: %w", err)
	}

	if _, err := io.Copy(part, bytes.NewReader(fileContent)); err != nil {
		return nil, fmt.Errorf("failed to write file content: %w", err)
	}

	// Close multipart writer to finalize the form
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("failed to close multipart writer: %w", err)
	}

	// Create HTTP request
	url := fmt.Sprintf("%s/forms/libreoffice/convert", c.config.APIURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())

	// Send request
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request to Gotenberg: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Gotenberg returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	// Read PDF content
	pdfContent, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read PDF content: %w", err)
	}

	return pdfContent, nil
}

// ConvertDOCXFromURL downloads a DOCX from URL and converts it to PDF
func (c *GotenbergConverter) ConvertDOCXFromURL(ctx context.Context, docxURL string) ([]byte, error) {
	// Download DOCX file
	req, err := http.NewRequestWithContext(ctx, "GET", docxURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create download request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to download DOCX: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to download DOCX, status %d", resp.StatusCode)
	}

	docxContent, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read DOCX content: %w", err)
	}

	// Convert to PDF
	return c.ConvertDOCXToPDF(ctx, docxContent, "document.docx")
}

// IsAvailable checks if Gotenberg service is reachable
func (c *GotenbergConverter) IsAvailable(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, "GET", c.config.APIURL+"/health", nil)
	if err != nil {
		return false
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK
}
