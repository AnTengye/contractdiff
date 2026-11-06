package converter

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/service/pdfcheck"
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
	if cfg.MaxInputBytes <= 0 {
		cfg.MaxInputBytes = 50 << 20
	}
	if cfg.MaxOutputBytes <= 0 {
		cfg.MaxOutputBytes = 50 << 20
	}
	if cfg.ReadRateBytesPerSecond <= 0 {
		cfg.ReadRateBytesPerSecond = 10 << 20
	}
	if cfg.Revision == "" {
		cfg.Revision = "gotenberg-pdf-v1"
	}

	return &GotenbergConverter{
		config: cfg,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}, nil
}

func (c *GotenbergConverter) Revision() string {
	return c.config.Revision
}

// ConvertDOCXToPDF converts a DOCX file to PDF
// fileContent is the DOCX file data
// filename is the name of the file (e.g., "document.docx")
// Returns the PDF file data
func (c *GotenbergConverter) ConvertDOCXToPDF(ctx context.Context, fileContent []byte, filename string) ([]byte, error) {
	if int64(len(fileContent)) > c.config.MaxInputBytes {
		return nil, fmt.Errorf("DOCX exceeds maximum input size of %d bytes", c.config.MaxInputBytes)
	}
	return c.convertDOCXBytes(ctx, fileContent, filename, extractDOCXTextSample(fileContent))
}

func (c *GotenbergConverter) convertDOCXBytes(ctx context.Context, fileContent []byte, filename, textSample string) ([]byte, error) {
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

	if c.config.BasicAuthUser != "" || c.config.BasicAuthPassword != "" {
		req.SetBasicAuth(c.config.BasicAuthUser, c.config.BasicAuthPassword)
	}

	// Send request
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request to Gotenberg: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := c.readBody(ctx, resp.Body, c.config.MaxOutputBytes)
		return nil, fmt.Errorf("Gotenberg returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if contentType != "" && !strings.Contains(contentType, "application/pdf") &&
		!strings.Contains(contentType, "application/octet-stream") {
		return nil, fmt.Errorf("Gotenberg returned non-PDF content type %q", contentType)
	}

	// Read PDF content
	pdfContent, err := c.readBody(ctx, resp.Body, c.config.MaxOutputBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to read PDF content: %w", err)
	}
	if len(pdfContent) < 5 || !bytes.HasPrefix(pdfContent, []byte("%PDF-")) {
		return nil, fmt.Errorf("Gotenberg returned a non-PDF response")
	}
	if textSample != "" {
		if _, err := pdfcheck.Validate(pdfContent, pdfcheck.Options{
			MaxBytes: c.config.MaxOutputBytes, TextSample: textSample, RequireText: true,
		}); err != nil {
			return nil, fmt.Errorf("converted PDF validation failed: %w", err)
		}
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
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(contentType, "text/html") {
		return nil, fmt.Errorf("DOCX download returned HTML instead of a document")
	}

	docxContent, err := c.readBody(ctx, resp.Body, c.config.MaxInputBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to read DOCX content: %w", err)
	}

	// Convert to PDF
	return c.convertDOCXBytes(ctx, docxContent, "document.docx", extractDOCXTextSample(docxContent))
}

func (c *GotenbergConverter) readBody(ctx context.Context, body io.Reader, limit int64) ([]byte, error) {
	if limit <= 0 {
		limit = 50 << 20
	}
	var output bytes.Buffer
	buffer := make([]byte, 32*1024)
	reader := &pacedReader{
		ctx: ctx, source: body, bytesPerSecond: c.config.ReadRateBytesPerSecond,
	}
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			if int64(output.Len()+n) > limit {
				return nil, fmt.Errorf("response exceeds maximum size of %d bytes", limit)
			}
			_, _ = output.Write(buffer[:n])
		}
		if err == io.EOF {
			return output.Bytes(), nil
		}
		if err != nil {
			return nil, err
		}
	}
}

type pacedReader struct {
	ctx            context.Context
	source         io.Reader
	bytesPerSecond int64
	readBytes      int64
	started        time.Time
}

func (r *pacedReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if r.started.IsZero() {
		r.started = time.Now()
	}
	n, err := r.source.Read(p)
	if n > 0 && r.bytesPerSecond > 0 {
		r.readBytes += int64(n)
		expected := time.Duration(float64(r.readBytes) / float64(r.bytesPerSecond) * float64(time.Second))
		wait := expected - time.Since(r.started)
		if wait > 0 {
			timer := time.NewTimer(wait)
			select {
			case <-r.ctx.Done():
				timer.Stop()
				return n, r.ctx.Err()
			case <-timer.C:
			}
		}
	}
	return n, err
}

func extractDOCXTextSample(data []byte) string {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ""
	}
	for _, file := range reader.File {
		if file.Name != "word/document.xml" {
			continue
		}
		stream, err := file.Open()
		if err != nil {
			return ""
		}
		defer stream.Close()
		decoder := xml.NewDecoder(stream)
		var text strings.Builder
		for {
			token, tokenErr := decoder.Token()
			if tokenErr == io.EOF {
				break
			}
			if tokenErr != nil {
				return ""
			}
			if charData, ok := token.(xml.CharData); ok {
				text.Write([]byte(charData))
			}
		}
		sample := strings.Map(func(r rune) rune {
			if unicode.IsSpace(r) {
				return -1
			}
			return r
		}, text.String())
		if len([]rune(sample)) > 64 {
			return string([]rune(sample)[:64])
		}
		return sample
	}
	return ""
}

// IsAvailable checks if Gotenberg service is reachable
func (c *GotenbergConverter) IsAvailable(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, "GET", c.config.APIURL+"/health", nil)
	if err != nil {
		return false
	}

	if c.config.BasicAuthUser != "" || c.config.BasicAuthPassword != "" {
		req.SetBasicAuth(c.config.BasicAuthUser, c.config.BasicAuthPassword)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK
}
