package aidiff

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/AnTengye/contractdiff/backend/config"
)

func TestResponsesContractAndFailureModes(t *testing.T) {
	for _, test := range []struct {
		name, status, content string
		httpStatus            int
		wantError             bool
	}{
		{"complete", "completed", `{"complete":true,"differences":[],"notes":[]}`, 200, false},
		{"truncated", "incomplete", `{"complete":true,"differences":[],"notes":[]}`, 200, true},
		{"partial", "completed", `{"complete":false,"differences":[],"notes":[]}`, 200, true},
		{"missing-findings", "completed", `{"complete":true,"notes":[]}`, 200, true},
		{"invalid-json", "completed", `nonsense`, 200, true},
		{"auth", "", `secret diagnostic`, 401, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if json.NewDecoder(r.Body).Decode(&body) != nil {
					t.Error("invalid request")
				}
				if r.URL.Path != "/v1/responses" || body["model"] != "gpt-6-luna" || body["store"] != false || body["reasoning"].(map[string]any)["effort"] != "medium" || r.Header.Get("Authorization") != "Bearer test-only" {
					t.Errorf("wrong request contract")
				}
				format := body["text"].(map[string]any)["format"].(map[string]any)
				if format["strict"] != true || format["type"] != "json_schema" {
					t.Error("strict output schema missing")
				}
				w.WriteHeader(test.httpStatus)
				_ = json.NewEncoder(w).Encode(map[string]any{"status": test.status, "output": []any{map[string]any{"content": []any{map[string]string{"type": "output_text", "text": test.content}}}}})
			}))
			defer server.Close()
			client := OpenAI{Config: config.AIDiffConfig{APIURL: server.URL + "/v1", APIKey: "test-only", Model: "gpt-6-luna", Reasoning: "medium"}}
			_, err := client.Compare(context.Background(), Input{})
			if (err != nil) != test.wantError {
				t.Fatalf("error=%v", err)
			}
			if err != nil && strings.Contains(err.Error(), "secret diagnostic") {
				t.Fatal("upstream diagnostic leaked")
			}
		})
	}
}
