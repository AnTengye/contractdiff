package parser

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AnTengye/contractdiff/backend/config"
)

func TestPaddleRejectsUnsuccessfulEnvelopeAndReleasesConsumedBytes(t *testing.T) {
	for _, body := range []string{`{"errorCode":123,"errorMsg":"failure","result":{}}`, `<html>not an API</html>`, `{"errorCode":0,"result":{"layoutParsingResults":[]}}`} {
		var requestBody map[string]interface{}
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/file" {
				w.Write([]byte("%PDF test"))
				return
			}
			json.NewDecoder(r.Body).Decode(&requestBody)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(body))
		}))
		p, err := NewPaddleOCRParser(&config.PaddleOCRConfig{Enabled: true, APIURL: server.URL + "/layout-parsing"})
		if err != nil {
			t.Fatal(err)
		}
		id, err := p.CreateTask(context.Background(), server.URL+"/file", "envelope-fixture")
		if body[0] == '<' || requestBody == nil || body == `{"errorCode":123,"errorMsg":"failure","result":{}}` {
			if err == nil {
				t.Fatal("unsuccessful HTTP 200 presented as successful parsing")
			}
		} else {
			if err != nil {
				t.Fatal(err)
			}
			if requestBody["useLayoutDetection"] != true || requestBody["visualize"] != false {
				t.Fatal("layout granularity or response size defaults changed")
			}
			if _, err = p.FetchResult(context.Background(), id, ""); err != nil {
				t.Fatal(err)
			}
			if _, ok := p.getStoredResult(id); ok {
				t.Fatal("consumed serialized result retained in memory")
			}
		}
		server.Close()
	}
}
