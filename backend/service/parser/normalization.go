package parser

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/html"
)

const NormalizationVersion = "contract-v2"

const ProcessingPipelineVersion = "pdf-input-v1"

// Identity contains only reproducibility settings; credentials never enter artifacts.
type Identity struct {
	Signature string                 `json:"signature"`
	Version   string                 `json:"version"`
	Settings  map[string]interface{} `json:"settings"`
}

func ParserIdentity(p DocumentParser) Identity {
	settings := map[string]interface{}{"parser": p.GetCapabilities().Type, "normalizer": NormalizationVersion}
	version := "unknown"
	switch v := p.(type) {
	case *MineruParser:
		settings["endpoint"] = safeEndpoint(v.config.APIURL)
		settings["requested_model"] = v.config.ModelVersion
		settings["declared_model_revision"] = v.config.ModelRevision
	case *PaddleOCRParser:
		settings["endpoint"] = safeEndpoint(v.config.APIURL)
		settings["declared_model_revision"] = v.config.ModelRevision
		settings["layout"] = boolDefault(v.config.UseLayoutDetection, true)
		settings["orientation"] = boolDefault(v.config.UseDocOrientationClassify, false)
		settings["unwarping"] = boolDefault(v.config.UseDocUnwarping, false)
		settings["chart"] = boolDefault(v.config.UseChartRecognition, false)
		settings["merge_tables"] = boolDefault(v.config.MergeTables, false)
		settings["restructure_pages"] = boolDefault(v.config.RestructurePages, false)
		settings["prettify_markdown"] = boolDefault(v.config.PrettifyMarkdown, true)
		settings["prompt"] = v.config.PromptLabel
	}
	b, _ := json.Marshal(settings)
	sum := sha256.Sum256(b)
	return Identity{Signature: hex.EncodeToString(sum[:]), Version: version, Settings: settings}
}

// ProcessingSignature identifies the complete input path. Conversion settings
// are deliberately included only for DOCX, so a Gotenberg revision cannot
// invalidate an otherwise identical native PDF result.
func ProcessingSignature(originalFormat string, identity Identity, conversionRevision string) string {
	settings := map[string]string{
		"pipeline":         ProcessingPipelineVersion,
		"original_format":  originalFormat,
		"parser_signature": identity.Signature,
		"normalizer":       NormalizationVersion,
	}
	if originalFormat == "docx" {
		settings["conversion_revision"] = conversionRevision
	}
	b, _ := json.Marshal(settings)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// ResultSignature binds the published parser result to the exact PDF bytes
// and the complete processing pipeline. It is intentionally not a new cache
// layer; it is an evidence check for cache reads and feedback replay.
func ResultSignature(pdfHash, processingSignature string) string {
	sum := sha256.Sum256([]byte(pdfHash + ":" + processingSignature))
	return hex.EncodeToString(sum[:])
}

func safeEndpoint(s string) string {
	u, err := url.Parse(s)
	if err != nil {
		return "unknown"
	}
	u.User = nil
	u.RawQuery, u.Fragment = "", ""
	return u.String()
}

func boolDefault(v *bool, fallback bool) bool {
	if v != nil {
		return *v
	}
	return fallback
}

func cloneJSONMap(value map[string]interface{}) map[string]interface{} {
	if value == nil {
		return nil
	}
	copy := make(map[string]interface{}, len(value))
	for key, item := range value {
		copy[key] = cloneJSONValue(item)
	}
	return copy
}

func cloneJSONValue(value interface{}) interface{} {
	switch v := value.(type) {
	case nil:
		return nil
	case map[string]interface{}:
		return cloneJSONMap(v)
	case []interface{}:
		copy := make([]interface{}, len(v))
		for i, item := range v {
			copy[i] = cloneJSONValue(item)
		}
		return copy
	case []float64:
		return append([]float64(nil), v...)
	case []string:
		return append([]string(nil), v...)
	default:
		return value
	}
}

func finalizeNormalized(result map[string]interface{}) (map[string]interface{}, error) {
	paragraphs, _ := result["paragraphs"].([]interface{})
	paragraphs = append([]interface{}(nil), paragraphs...)
	result["paragraphs"] = paragraphs
	tables := []interface{}{}
	characters := 0
	for index, item := range paragraphs {
		block, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		copy := map[string]interface{}{}
		for key, value := range block {
			copy[key] = value
		}
		block = copy
		paragraphs[index] = block
		if block["type"] == "table" {
			if _, ok := block["cells"]; !ok {
				block["cells"] = tableCells(findHTML(block))
			}
			tables = append(tables, block)
		}
		characters += utf8.RuneCountInString(strings.TrimSpace(blockText(block)))
	}
	if characters == 0 {
		return nil, fmt.Errorf("parser returned no comparable text or table cells; unsupported result schema or empty recognition")
	}
	result["tables"] = tables
	metadata, _ := result["metadata"].(map[string]interface{})
	if metadata == nil {
		metadata = map[string]interface{}{}
		result["metadata"] = metadata
	}
	metadata["normalization_version"] = NormalizationVersion
	metadata["comparable_characters"] = characters
	return result, nil
}

// Preserve genuine model line/cell geometry when present. If OCR and VL texts
// disagree, retain the VL block and its coarse geometry rather than invent boxes.
func attachPaddleStructure(paragraph, block, pruned map[string]interface{}) {
	if cells, ok := block["cells"].([]interface{}); ok {
		paragraph["cells"] = cells
	}
	if lines, ok := block["lines"].([]interface{}); ok && len(lines) > 0 {
		paragraph["lines"] = lines
		return
	}
	if paragraph["type"] == "table" {
		return
	}
	ocr, ok := pruned["overall_ocr_res"].(map[string]interface{})
	if !ok {
		return
	}
	texts, ok := ocr["rec_texts"].([]interface{})
	if !ok {
		return
	}
	boxes, ok := ocr["rec_boxes"].([]interface{})
	if !ok || len(texts) != len(boxes) {
		return
	}
	bbox, ok := paragraph["bbox"].([]float64)
	if !ok || len(bbox) != 4 {
		return
	}
	content, _ := paragraph["text"].(string)
	clean := func(s string) string {
		return strings.Map(func(r rune) rune {
			if unicode.IsSpace(r) {
				return -1
			}
			return r
		}, s)
	}
	type line struct {
		text string
		bbox []interface{}
	}
	selected := []line{}
	var joined strings.Builder
	for i, value := range texts {
		text, ok := value.(string)
		if !ok || clean(text) == "" {
			continue
		}
		box, ok := boxes[i].([]interface{})
		if !ok || len(box) != 4 {
			continue
		}
		x0, _ := box[0].(float64)
		y0, _ := box[1].(float64)
		x1, _ := box[2].(float64)
		y1, _ := box[3].(float64)
		if x0 < bbox[0]-1 || y0 < bbox[1]-1 || x1 > bbox[2]+1 || y1 > bbox[3]+1 {
			continue
		}
		selected = append(selected, line{text: text, bbox: box})
		joined.WriteString(clean(text))
	}
	if len(selected) == 0 || joined.String() != clean(content) {
		return
	}
	positions := []int{}
	for index, r := range content {
		if !unicode.IsSpace(r) {
			positions = append(positions, index)
		}
	}
	positions = append(positions, len(content))
	count := 0
	start := 0
	lines := []interface{}{}
	for i, item := range selected {
		count += utf8.RuneCountInString(clean(item.text))
		end := positions[count]
		if i == len(selected)-1 {
			end = len(content)
		}
		lines = append(lines, map[string]interface{}{"bbox": item.bbox, "spans": []interface{}{map[string]interface{}{"content": content[start:end], "bbox": item.bbox}}})
		start = end
	}
	paragraph["lines"] = lines
}

func findHTML(block map[string]interface{}) string {
	for _, key := range []string{"html", "text", "block_content"} {
		if s, _ := block[key].(string); strings.Contains(strings.ToLower(s), "<table") {
			return s
		}
	}
	for _, key := range []string{"blocks", "lines", "spans"} {
		items, _ := block[key].([]interface{})
		for _, item := range items {
			if child, ok := item.(map[string]interface{}); ok {
				if s := findHTML(child); s != "" {
					return s
				}
			}
		}
	}
	return ""
}

func blockText(block map[string]interface{}) string {
	if block["type"] == "table" {
		cells, _ := block["cells"].([]interface{})
		var out strings.Builder
		for _, item := range cells {
			if cell, ok := item.(map[string]interface{}); ok {
				out.WriteString(blockText(cell))
			}
		}
		return out.String()
	}
	for _, key := range []string{"text", "content"} {
		if s, ok := block[key].(string); ok && s != "" {
			return s
		}
	}
	var out strings.Builder
	for _, key := range []string{"blocks", "lines", "spans"} {
		items, _ := block[key].([]interface{})
		for _, item := range items {
			if child, ok := item.(map[string]interface{}); ok {
				out.WriteString(blockText(child))
			}
		}
	}
	return out.String()
}

// HTML carries cell structure but no cell geometry. Keep that distinction explicit.
func tableCells(source string) []interface{} {
	cells := []interface{}{}
	if source == "" {
		return cells
	}
	root, err := html.Parse(strings.NewReader(source))
	if err != nil {
		return cells
	}
	occupied := map[[2]int]bool{}
	row := 0
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "tr" {
			col := 0
			for cell := n.FirstChild; cell != nil; cell = cell.NextSibling {
				if cell.Type != html.ElementNode || (cell.Data != "td" && cell.Data != "th") {
					continue
				}
				for occupied[[2]int{row, col}] {
					col++
				}
				rs, cs := 1, 1
				for _, attr := range cell.Attr {
					value, _ := strconv.Atoi(attr.Val)
					if value > 0 && value <= 1000 {
						if attr.Key == "rowspan" {
							rs = value
						}
						if attr.Key == "colspan" {
							cs = value
						}
					}
				}
				cells = append(cells, map[string]interface{}{"row": row, "col": col, "rowspan": rs, "colspan": cs, "text": htmlText(cell), "coordinate_precision": "block"})
				for r := row; r < row+rs; r++ {
					for c := col; c < col+cs; c++ {
						occupied[[2]int{r, c}] = true
					}
				}
				col += cs
			}
			row++
			return
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(root)
	return cells
}

func htmlText(n *html.Node) string {
	var out strings.Builder
	var visit func(*html.Node)
	visit = func(node *html.Node) {
		if node.Type == html.TextNode {
			out.WriteString(node.Data)
		}
		if node.Type == html.ElementNode && (node.Data == "br" || node.Data == "p") {
			out.WriteString("\n")
		}
		if node.Data == "script" || node.Data == "style" {
			return
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(n)
	return strings.TrimSpace(out.String())
}
