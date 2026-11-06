package handler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/AnTengye/contractdiff/backend/model"
	"github.com/AnTengye/contractdiff/backend/pkg/timing"
	"github.com/AnTengye/contractdiff/backend/service"
	"github.com/AnTengye/contractdiff/backend/service/parser"
)

type completedFixtureParser struct{ invalid bool }

func (*completedFixtureParser) GetCapabilities() parser.ParserCapabilities {
	return parser.ParserCapabilities{Type: "fixture"}
}
func (*completedFixtureParser) CanParse(string) bool { return true }
func (*completedFixtureParser) CreateTask(context.Context, string, string) (string, error) {
	return "fixture", nil
}
func (*completedFixtureParser) GetTaskStatus(context.Context, string) (*parser.TaskStatus, error) {
	return &parser.TaskStatus{State: "completed"}, nil
}
func (*completedFixtureParser) FetchResult(context.Context, string, string) (map[string]interface{}, error) {
	return map[string]interface{}{"text": "raw recognition evidence"}, nil
}
func (p *completedFixtureParser) NormalizeResult(raw map[string]interface{}) (map[string]interface{}, error) {
	if p.invalid {
		return nil, errors.New("unknown schema")
	}
	return raw, nil
}

func TestCompletedParserImmediateReadAndFailureEvidence(t *testing.T) {
	for _, invalid := range []bool{false, true} {
		id := "immediate-parser"
		if invalid {
			id += "-invalid"
		}
		store := service.GetContractStore()
		contract := &model.Contract{ID: id, Tenant: "fixture", TaskID: "fixture", Status: model.StatusProcessing, Metadata: &model.ContractMetadata{}, CreatedAt: time.Now()}
		store.Save(contract)
		h := &ContractHandler{store: store}
		tracker := timing.New(timing.TraceContext{})
		start := time.Now()
		h.pollParserTask(contract, &completedFixtureParser{invalid: invalid}, tracker, "test")
		if time.Since(start) > time.Second {
			t.Fatal("synchronous result incurred a polling sleep")
		}
		got := store.Get(id)
		if invalid {
			if got.Status != model.StatusFailed || got.RawJSONData == nil {
				t.Fatal("failed normalization lost upstream evidence")
			}
		} else if got.Status != model.StatusCompleted {
			t.Fatal("completed parser not published")
		}
		store.Delete(id)
	}
}

func TestCoordinateValidationDegradesWithoutInventingBoxes(t *testing.T) {
	pages := []model.PDFPageMetadata{{PageIdx: 0, Width: 200, Height: 100}}
	status, warnings := validateNormalizedCoordinates(map[string]interface{}{
		"paragraphs": []interface{}{
			map[string]interface{}{"page": 1, "text": "无坐标正文"},
		},
	}, pages)
	if status != "unavailable" || len(warnings) == 0 {
		t.Fatalf("missing coordinates were not degraded: status=%s warnings=%v", status, warnings)
	}

	status, warnings = validateNormalizedCoordinates(map[string]interface{}{
		"paragraphs": []interface{}{
			map[string]interface{}{"page": 1, "text": "定位正文", "bbox": []interface{}{10.0, 10.0, 80.0, 30.0}},
			map[string]interface{}{"page": 2, "text": "越界正文", "bbox": []interface{}{10.0, 10.0, 300.0, 30.0}},
		},
	}, pages)
	if status != "partial" || len(warnings) == 0 {
		t.Fatalf("invalid coordinates were not degraded: status=%s warnings=%v", status, warnings)
	}
}
