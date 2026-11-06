// Renormalize an exported case locally before replaying the frontend expectations.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/AnTengye/contractdiff/backend/service/parser"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: replay-feedback case.json > normalized-case.json")
		os.Exit(2)
	}
	b, err := os.ReadFile(os.Args[1])
	if err != nil {
		fail(err)
	}
	var fixture struct {
		Schema      string                      `json:"schema_version"`
		Case        model.Feedback              `json:"case"`
		Snapshot    model.FeedbackSnapshot      `json:"snapshot"`
		Expectation model.RegressionExpectation `json:"expectation"`
	}
	if err = json.Unmarshal(b, &fixture); err != nil {
		fail(err)
	}
	if fixture.Schema != "regression-v1" {
		fail(fmt.Errorf("unsupported regression schema"))
	}
	for side, document := range fixture.Snapshot.Documents {
		raw, ok := document.RawData.(map[string]interface{})
		if !ok {
			fail(fmt.Errorf("%s has no raw parser snapshot", side))
		}
		var normalized map[string]interface{}
		switch document.ParserType {
		case "mineru":
			normalized, err = (&parser.MineruParser{}).NormalizeResult(raw)
		case "paddleocr":
			normalized, err = (&parser.PaddleOCRParser{}).NormalizeResult(raw)
		default:
			err = fmt.Errorf("unsupported parser %s", document.ParserType)
		}
		if err != nil {
			fail(err)
		}
		document.Data = normalized
		document.NormalizationVersion = parser.NormalizationVersion
		fixture.Snapshot.Documents[side] = document
	}
	if err = json.NewEncoder(os.Stdout).Encode(fixture); err != nil {
		fail(err)
	}
}
func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
