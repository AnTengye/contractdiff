package handler

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/AnTengye/contractdiff/backend/config"
	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/AnTengye/contractdiff/backend/pkg/httpclient"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/AnTengye/contractdiff/backend/service/converter"
	"github.com/AnTengye/contractdiff/backend/service/parser"
	"github.com/gin-gonic/gin"
)

type nativeDocxPreviewParser struct{ inputURL string }

func (*nativeDocxPreviewParser) GetCapabilities() parser.ParserCapabilities {
	return parser.ParserCapabilities{Type: "preview-fixture", MaxFileSize: 50 << 20}
}
func (*nativeDocxPreviewParser) CanParse(string) bool { return true }
func (p *nativeDocxPreviewParser) CreateTask(_ context.Context, inputURL, _ string) (string, error) {
	p.inputURL = inputURL
	return "", fmt.Errorf("stop after capturing parser input")
}
func (*nativeDocxPreviewParser) GetTaskStatus(context.Context, string) (*parser.TaskStatus, error) {
	panic("unexpected task polling")
}
func (*nativeDocxPreviewParser) FetchResult(context.Context, string, string) (map[string]interface{}, error) {
	panic("unexpected result fetch")
}
func (*nativeDocxPreviewParser) NormalizeResult(map[string]interface{}) (map[string]interface{}, error) {
	panic("unexpected normalization")
}

func docxPreviewFixturePDF() []byte {
	content := "BT /F1 12 Tf 10 50 Td (preview fixture) Tj ET"
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	var data bytes.Buffer
	data.WriteString("%PDF-1.4\n")
	var offsets []int
	for i, object := range objects {
		offsets = append(offsets, data.Len())
		fmt.Fprintf(&data, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := data.Len()
	fmt.Fprintf(&data, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets {
		fmt.Fprintf(&data, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&data, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	return data.Bytes()
}

func TestDOCXPreviewConvertsEvenWhenParserSupportsDOCX(t *testing.T) {
	var converted, stored atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/source.docx":
			w.Write([]byte("DOCX fixture"))
		case r.Method == http.MethodPost && r.URL.Path == "/forms/libreoffice/convert":
			converted.Store(true)
			w.Header().Set("Content-Type", "application/pdf")
			w.Write(docxPreviewFixturePDF())
		case r.URL.Query().Has("location"):
			w.Header().Set("Content-Type", "application/xml")
			w.Write([]byte(`<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>`))
		case r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/converted.pdf"):
			stored.Store(true)
			w.Header().Set("ETag", `"fixture"`)
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	conv, err := converter.NewGotenbergConverter(&config.GotenbergConfig{Enabled: true, APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	storage, err := service.NewMinioService(&config.MinioConfig{
		Endpoint: strings.TrimPrefix(server.URL, "http://"), Bucket: "pdfdiff", AccessKey: "fixture", SecretKey: "fixture-secret", ExpireDays: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	store := service.GetContractStore()
	contract := &model.Contract{ID: "docx-preview-conversion", Tenant: "fixture", OriginalFormat: "docx", FileURL: server.URL + "/source.docx", Status: model.StatusPending, Metadata: &model.ContractMetadata{}, CreatedAt: time.Now()}
	store.Save(contract)
	defer store.Delete(contract.ID)
	p := &nativeDocxPreviewParser{}
	h := &ContractHandler{store: store, converter: conv, minioService: storage, timingConfig: &config.TimingConfig{}}
	h.processDocument(contract, p, "fixture", "fixture")
	if !converted.Load() || !stored.Load() || !strings.Contains(p.inputURL, "/converted.pdf?") {
		t.Fatalf("DOCX was not converted and stored before parsing: converted=%v stored=%v input=%q", converted.Load(), stored.Load(), p.inputURL)
	}
	got := store.Get(contract.ID)
	if !got.Metadata.ConvertedFromDOCX || got.ConvertedFileURL == "" || got.GetPDFURL() == got.FileURL {
		t.Fatal("preview still points at the original DOCX")
	}
}

func TestPDFPreviewRejectsWordAndHTMLBodies(t *testing.T) {
	for _, body := range []string{"PK\x03\x04Word document bytes", "<html>storage error</html>"} {
		t.Run(body[:2], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/pdf")
				w.Write([]byte(body))
			}))
			defer server.Close()
			store := service.GetContractStore()
			contract := &model.Contract{ID: "invalid-preview", Tenant: "fixture", OriginalFormat: "pdf", FileURL: server.URL, PDFURL: server.URL, CreatedAt: time.Now()}
			store.Save(contract)
			defer store.Delete(contract.ID)
			h := &ContractHandler{store: store, httpClient: httpclient.New()}
			router := gin.New()
			router.GET("/contracts/:id/pdf", func(c *gin.Context) {
				c.Set("tenant", "fixture")
				h.GetPDF(c)
			})
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/contracts/invalid-preview/pdf", nil))
			if w.Code < 400 || strings.HasPrefix(w.Header().Get("Content-Type"), "application/pdf") {
				t.Fatalf("invalid preview was served as PDF: status=%d content-type=%q", w.Code, w.Header().Get("Content-Type"))
			}
		})
	}
}
