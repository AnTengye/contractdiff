package aidiff

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/AnTengye/contractdiff/backend/model"
)

type textSpan struct {
	Content string `json:"content"`
}
type textLine struct {
	Spans []textSpan `json:"spans"`
}
type textCell struct {
	Text    string `json:"text"`
	Row     int    `json:"row"`
	Col     int    `json:"col"`
	Rowspan int    `json:"rowspan"`
	Colspan int    `json:"colspan"`
}
type textBlock struct {
	Type   string      `json:"type"`
	Page   int         `json:"page"`
	Text   string      `json:"text"`
	Lines  []textLine  `json:"lines"`
	Blocks []textBlock `json:"blocks"`
	Cells  []textCell  `json:"cells"`
}
type normalized struct {
	Paragraphs []textBlock `json:"paragraphs"`
	PDFInfo    []struct {
		PageIdx int         `json:"page_idx"`
		Blocks  []textBlock `json:"para_blocks"`
	} `json:"pdf_info"`
}

func blockText(b textBlock) string {
	var text strings.Builder
	if len(b.Blocks) > 0 {
		for _, child := range b.Blocks {
			text.WriteString(blockText(child))
		}
	} else if len(b.Lines) > 0 {
		for _, line := range b.Lines {
			for _, span := range line.Spans {
				text.WriteString(span.Content)
			}
		}
	} else {
		text.WriteString(b.Text)
	}
	return text.String()
}

// Extract uses the same paragraph/cell order as the structured-v3 text extractor.
// IDs bind references to the canonical displayed PDF and the exact normalized snapshot.
func Extract(c *model.Contract, side string, options Options) (Document, error) {
	body, err := json.Marshal(c.JSONData)
	if err != nil {
		return Document{}, fmt.Errorf("文档结果不可读取")
	}
	var data normalized
	if err := json.Unmarshal(body, &data); err != nil {
		return Document{}, fmt.Errorf("文档结果不可读取")
	}
	sum := sha256.Sum256(body)
	identity := sha256.Sum256([]byte(c.PDFHash + ":" + c.ResultSignature + ":" + hex.EncodeToString(sum[:])))
	prefix := side + "-" + hex.EncodeToString(identity[:8])
	blocks := data.Paragraphs
	if blocks == nil {
		sort.SliceStable(data.PDFInfo, func(i, j int) bool { return data.PDFInfo[i].PageIdx < data.PDFInfo[j].PageIdx })
		for _, page := range data.PDFInfo {
			for _, block := range page.Blocks {
				block.Page = page.PageIdx + 1
				blocks = append(blocks, block)
			}
		}
	}
	doc := Document{PDFHash: c.PDFHash, ResultSignature: c.ResultSignature, Units: []Unit{}}
	table := 0
	add := func(text, kind, structure string, page, block int) {
		if strings.TrimSpace(text) == "" {
			return
		}
		idx := len(doc.Units)
		doc.Units = append(doc.Units, Unit{ID: fmt.Sprintf("%s-p%d-b%d-u%d", prefix, page, block, idx), Index: idx, PageIdx: page, BlockIdx: block, Text: text, Kind: kind, Structure: structure})
	}
	for idx, b := range blocks {
		if options.IgnoreHeaders {
			switch b.Type {
			case "header", "footer", "page_header", "page_footer", "page_number":
				continue
			}
		}
		page := b.Page - 1
		if page < 0 {
			page = 0
		}
		if b.Type == "table" {
			if len(b.Cells) == 0 {
				return Document{}, fmt.Errorf("表格缺少单元格结构，AI 未启动；算法结果仍可使用")
			}
			for _, cell := range b.Cells {
				rspan, cspan := cell.Rowspan, cell.Colspan
				if rspan <= 0 {
					rspan = 1
				}
				if cspan <= 0 {
					cspan = 1
				}
				text := cell.Text
				if text == "" {
					text = "（空单元格）"
				}
				add(text, "cell", fmt.Sprintf("%d:%d:%d:%d:%d", table, cell.Row, cell.Col, rspan, cspan), page, idx)
			}
			table++
		} else {
			add(blockText(b), b.Type, "", page, idx)
		}
	}
	if len(doc.Units) == 0 {
		return Document{}, fmt.Errorf("文档没有可供 AI 比对的文本")
	}
	return doc, nil
}

// compact retains original UTF-16 positions while removing whitespace only.
func compact(s string) (string, []int, []int) {
	var text strings.Builder
	starts, ends := []int{}, []int{}
	offset := 0
	for _, r := range s {
		n := 1
		if r > 0xffff {
			n = 2
		}
		if !unicode.IsSpace(r) && r != '\ufeff' {
			text.WriteRune(r)
			starts = append(starts, offset)
			ends = append(ends, offset+n)
		}
		offset += n
	}
	return text.String(), starts, ends
}

func Resolve(ref Reference, doc Document) Location {
	location := resolveReference(ref, doc)
	if location.Status == "unresolved" && strings.TrimSpace(ref.Quote) != "" {
		// Repair an invalid model index only with verbatim evidence from this
		// canonical snapshot. Repeated quotes still require candidate selection.
		fallback := resolveReference(referenceForQuote(ref.Quote, doc), doc)
		if fallback.Status == "verified" {
			fallback.Reason = "已在原文中唯一匹配该引文"
			return fallback
		}
		if fallback.Status == "ambiguous" {
			return fallback
		}
	}
	return location
}

func resolveReference(ref Reference, doc Document) Location {
	location := Location{Quote: ref.Quote, Status: "unresolved", Candidates: []Candidate{}}
	quote, _, _ := compact(ref.Quote)
	if quote == "" {
		if len(ref.UnitIDs) == 0 {
			location.Status = "not_applicable"
		} else {
			location.Reason = "引文为空，无法核对定位"
		}
		return location
	}
	selected := make([]Unit, 0, len(ref.UnitIDs))
	seen := map[string]bool{}
	for _, id := range ref.UnitIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		found := false
		for _, unit := range doc.Units {
			if unit.ID == id {
				selected = append(selected, unit)
				found = true
				break
			}
		}
		if !found {
			location.Reason = "AI 引用的单元不存在"
			return location
		}
	}
	if len(selected) == 0 {
		location.Reason = "AI 未引用原文单元"
		return location
	}
	sort.Slice(selected, func(i, j int) bool { return selected[i].Index < selected[j].Index })
	// Each individual unit is searched independently. Multi-unit quotes are also
	// allowed, but never across a gap in the actual extraction order.
	groups := [][]Unit{}
	for _, unit := range selected {
		if len(groups) == 0 || groups[len(groups)-1][len(groups[len(groups)-1])-1].Index+1 != unit.Index {
			groups = append(groups, []Unit{unit})
		} else {
			groups[len(groups)-1] = append(groups[len(groups)-1], unit)
		}
	}
	needle := []rune(quote)
	for _, group := range groups {
		haystack := []rune{}
		type position struct {
			unit       Unit
			start, end int
		}
		positions := []position{}
		for _, unit := range group {
			t, starts, ends := compact(unit.Text)
			haystack = append(haystack, []rune(t)...)
			for i := range starts {
				positions = append(positions, position{unit, starts[i], ends[i]})
			}
		}
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if string(haystack[i:i+len(needle)]) != quote {
				continue
			}
			ranges := []Range{}
			for _, p := range positions[i : i+len(needle)] {
				if len(ranges) > 0 && ranges[len(ranges)-1].UnitIndex == p.unit.Index {
					ranges[len(ranges)-1].End = p.end
				} else {
					ranges = append(ranges, Range{p.unit.Index, p.unit.ID, p.start, p.end})
				}
			}
			location.Candidates = append(location.Candidates, Candidate{ranges})
			if len(location.Candidates) > 20 {
				location.Candidates = nil
				location.Reason = "重复引文过多，请提供更长上下文"
				return location
			}
		}
	}
	if len(location.Candidates) == 1 {
		location.Status = "verified"
	} else if len(location.Candidates) > 1 {
		location.Status = "ambiguous"
		location.Reason = "原文存在多个匹配位置，请选择候选位置核对"
	} else {
		location.Reason = "引文与引用单元不一致，未绘制高亮"
	}
	return location
}

func referenceForQuote(quote string, doc Document) Reference {
	ref := Reference{Quote: quote, UnitIDs: []string{}}
	needle, _, _ := compact(quote)
	if needle == "" {
		return ref
	}
	var full strings.Builder
	type interval struct {
		id         string
		start, end int
	}
	units := []interval{}
	for _, unit := range doc.Units {
		text, _, _ := compact(unit.Text)
		start := full.Len()
		full.WriteString(text)
		units = append(units, interval{unit.ID, start, full.Len()})
	}
	text := full.String()
	seen := map[string]bool{}
	for offset := 0; offset < len(text); {
		at := strings.Index(text[offset:], needle)
		if at < 0 {
			break
		}
		start := offset + at
		end := start + len(needle)
		for _, unit := range units {
			if unit.start < end && unit.end > start && !seen[unit.id] {
				ref.UnitIDs = append(ref.UnitIDs, unit.id)
				seen[unit.id] = true
			}
		}
		offset = start + 1
	}
	return ref
}
