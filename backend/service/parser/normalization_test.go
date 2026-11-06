package parser

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/AnTengye/contractdiff/backend/config"
)

func rawFixture(t *testing.T, s string) map[string]interface{} {
	t.Helper()
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(s), &raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestNormalizeTableOnlyAndMergedCells(t *testing.T) {
	raw := rawFixture(t, `{"result":{"layoutParsingResults":[{"prunedResult":{"width":1000,"height":700,"parsing_res_list":[{"block_label":"table","block_content":"<table><tr><th rowspan='2'>总价</th><td>10000 &amp; 20000</td></tr><tr><td>30000</td></tr></table>","block_bbox":[0,0,500,200]}]}}]}}`)
	result, err := (&PaddleOCRParser{}).NormalizeResult(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(result["tables"].([]interface{})) != 1 || len(result["paragraphs"].([]interface{})) != 1 {
		t.Fatal("table content disappeared")
	}
	cells := result["tables"].([]interface{})[0].(map[string]interface{})["cells"].([]interface{})
	if len(cells) != 3 || cells[2].(map[string]interface{})["col"] != 1 {
		t.Fatalf("merged-cell positions incorrect: %#v", cells)
	}
	if cells[1].(map[string]interface{})["text"] != "10000 & 20000" {
		t.Fatal("HTML text was not decoded")
	}
	if _, ok := cells[1].(map[string]interface{})["bbox"]; ok {
		t.Fatal("cell geometry was fabricated")
	}
}

func TestMinerUNormalizationPreservesPagesWithoutMutatingRaw(t *testing.T) {
	raw := rawFixture(t, `{"pdf_info":[{"page_idx":3,"page_size":[1000,700],"para_blocks":[{"type":"text","lines":[{"spans":[{"content":"条款","bbox":[0,0,100,20]}]}]}]}]}`)
	before, _ := json.Marshal(raw)
	result, err := (&MineruParser{}).NormalizeResult(raw)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(raw)
	if string(before) != string(after) {
		t.Fatal("raw evidence was changed during normalization")
	}
	block := result["paragraphs"].([]interface{})[0].(map[string]interface{})
	if block["page"] != 4 {
		t.Fatal("source page index was lost")
	}
	if len(result["metadata"].(map[string]interface{})["page_sizes"].([]interface{})) != 1 {
		t.Fatal("page dimensions were lost")
	}
}

func TestMinerUNormalizationDoesNotMutateImageBlocks(t *testing.T) {
	raw := rawFixture(t, `{"pdf_info":[{"page_idx":1,"para_blocks":[{"type":"image","img_path":"image.png"},{"type":"text","text":"正文"}]}]}`)
	before, _ := json.Marshal(raw)
	if _, err := (&MineruParser{}).NormalizeResult(raw); err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(raw)
	if string(before) != string(after) {
		t.Fatal("image normalization changed raw evidence")
	}
}

func TestNormalizationRejectsUnknownOrEmptyResults(t *testing.T) {
	for _, raw := range []map[string]interface{}{{}, {"pages": []interface{}{}}, {"pdf_info": []interface{}{}}, {"unexpected": "text"}} {
		if _, err := (&PaddleOCRParser{}).NormalizeResult(raw); err == nil {
			t.Fatal("PaddleOCR accepted empty/unknown recognition")
		}
		if _, err := (&MineruParser{}).NormalizeResult(raw); err == nil {
			t.Fatal("MinerU accepted empty/unknown recognition")
		}
	}
}

func TestPaddleRetainsMatchingOCRLines(t *testing.T) {
	raw := rawFixture(t, `{"result":{"layoutParsingResults":[{"prunedResult":{"width":1000,"height":700,"parsing_res_list":[{"block_label":"text","block_content":"第一行\n第二行","block_bbox":[0,0,100,100]}],"overall_ocr_res":{"rec_texts":["第一行","第二行"],"rec_boxes":[[0,0,80,10],[0,20,80,30]]}}}]}}`)
	result, err := (&PaddleOCRParser{}).NormalizeResult(raw)
	if err != nil {
		t.Fatal(err)
	}
	block := result["paragraphs"].([]interface{})[0].(map[string]interface{})
	lines, ok := block["lines"].([]interface{})
	if !ok || len(lines) != 2 {
		t.Fatal("genuine line geometry lost")
	}
	if blockText(block) != "第一行\n第二行" {
		t.Fatal("OCR line geometry changed the VL text")
	}
}

func TestParserIdentityIncludesModeButNeverCredentials(t *testing.T) {
	a := &MineruParser{config: &config.MineruConfig{APIURL: "https://example.test/api?token=private", APIToken: "private", ModelVersion: "vlm"}}
	b := &MineruParser{config: &config.MineruConfig{APIURL: "https://example.test/api", APIToken: "different", ModelVersion: "pipeline"}}
	ia, ib := ParserIdentity(a), ParserIdentity(b)
	if ia.Signature == ib.Signature {
		t.Fatal("different model modes share a cache")
	}
	encoded, _ := json.Marshal(ia)
	if strings.Contains(string(encoded), "private") || ia.Version != "unknown" {
		t.Fatal("credentials leaked or model version was invented")
	}
}

func TestProcessingSignatureScopesConversionRevisionToDOCX(t *testing.T) {
	identity := Identity{Signature: "parser", Version: "v1"}
	pdfA := ProcessingSignature("pdf", identity, "conversion-a")
	pdfB := ProcessingSignature("pdf", identity, "conversion-b")
	if pdfA != pdfB {
		t.Fatal("PDF cache signature changed with a Word-only conversion revision")
	}
	docxA := ProcessingSignature("docx", identity, "conversion-a")
	docxB := ProcessingSignature("docx", identity, "conversion-b")
	if docxA == docxB {
		t.Fatal("DOCX cache signature ignored conversion revision")
	}
	if ResultSignature("pdf-hash", pdfA) == ResultSignature("other-pdf-hash", pdfA) {
		t.Fatal("result signature did not bind the PDF hash")
	}
}
