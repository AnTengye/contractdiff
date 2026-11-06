package converter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AnTengye/contractdiff/backend/config"
)

func TestDOCXConversionRejectsWordAndHTMLBodies(t *testing.T) {
	for _, body := range []string{"PK\x03\x04Word document bytes", "<html>conversion error</html>"} {
		t.Run(body[:2], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/pdf")
				w.Write([]byte(body))
			}))
			defer server.Close()
			conv, err := NewGotenbergConverter(&config.GotenbergConfig{Enabled: true, APIURL: server.URL})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := conv.ConvertDOCXToPDF(context.Background(), []byte("DOCX fixture"), "fixture.docx"); err == nil {
				t.Fatal("non-PDF conversion result accepted")
			}
		})
	}
}
