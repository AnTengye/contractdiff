package model

import "testing"

func TestDOCXPreviewNeverUsesOriginalWordURL(t *testing.T) {
	c := &Contract{OriginalFormat: "docx", FileURL: "https://storage.test/source.docx", PDFURL: "https://storage.test/source.docx"}
	if got := c.GetPDFURL(); got != "" {
		t.Fatalf("original DOCX exposed as preview: %q", got)
	}
	c.ConvertedFileURL = "https://storage.test/converted.pdf"
	c.PDFHash = "verified-pdf-hash"
	c.PDFObjectKey = "fixture/converted.pdf"
	if got := c.GetPDFURL(); got != c.ConvertedFileURL {
		t.Fatalf("converted PDF not selected: %q", got)
	}
}
