package aidiff

import (
	"testing"

	"github.com/AnTengye/contractdiff/backend/model"
)

func sourceContract(text string) *model.Contract {
	return &model.Contract{PDFHash: "pdf-one", ResultSignature: "parse-one", JSONData: map[string]any{"paragraphs": []any{map[string]any{"text": text, "page": 2}}}}
}
func TestSourceReferencesPreserveSymbolsAndUTF16(t *testing.T) {
	c := sourceContract("甲方😀金额 -1,234.50%\n日期：____ 日期：____")
	doc, err := Extract(c, "left", Options{})
	if err != nil {
		t.Fatal(err)
	}
	unit := doc.Units[0]
	loc := Resolve(Reference{[]string{unit.ID}, "😀金额 -1,234.50%"}, doc)
	if loc.Status != "verified" || loc.Candidates[0].Ranges[0].Start != 2 || loc.Candidates[0].Ranges[0].End != 17 {
		t.Fatalf("UTF16 reference: %+v", loc)
	}
	for _, quote := range []string{"金额 1234.50%", "金额 -1,234.50", "日期:____"} {
		loc = Resolve(Reference{[]string{unit.ID}, quote}, doc)
		// A shorter quote is legal; altered punctuation must never be normalized.
		if quote != "金额 -1,234.50" && loc.Status != "unresolved" {
			t.Fatalf("invented quote accepted: %s", quote)
		}
	}
	loc = Resolve(Reference{[]string{unit.ID}, "日期：____"}, doc)
	if loc.Status != "ambiguous" || len(loc.Candidates) != 2 {
		t.Fatalf("repeated dates guessed: %+v", loc)
	}
	c.PDFHash = "different-pdf"
	changed, _ := Extract(c, "left", Options{})
	if doc.Units[0].ID == changed.Units[0].ID {
		t.Fatal("ID not bound to PDF")
	}
	c.PDFHash = "pdf-one"
	c.JSONData = map[string]any{"paragraphs": []any{map[string]any{"text": "修订内容", "page": 2}}}
	changed, _ = Extract(c, "left", Options{})
	if doc.Units[0].ID == changed.Units[0].ID {
		t.Fatal("ID not bound to parsed snapshot")
	}
}
func TestResolveDoesNotCrossUnreferencedUnits(t *testing.T) {
	doc := Document{Units: []Unit{{ID: "a", Index: 0, Text: "甲方"}, {ID: "b", Index: 1, Text: "中间文字"}, {ID: "c", Index: 2, Text: "日期"}}}
	loc := Resolve(Reference{[]string{"a", "c"}, "甲方日期"}, doc)
	if loc.Status != "unresolved" {
		t.Fatalf("crossed source gap: %+v", loc)
	}
	loc = Resolve(Reference{[]string{"a", "b"}, "甲方中间文字"}, doc)
	if loc.Status != "verified" || len(loc.Candidates[0].Ranges) != 2 {
		t.Fatalf("consecutive reference: %+v", loc)
	}
	if Resolve(Reference{[]string{}, ""}, doc).Status != "not_applicable" {
		t.Fatal("pure addition needs an empty counterpart")
	}
}

func TestInvalidModelUnitCanBeRepairedOnlyByVerbatimEvidence(t *testing.T) {
	doc := Document{Units: []Unit{{ID: "real", Index: 0, Text: "乙方签字：黄亚豪"}, {ID: "other", Index: 1, Text: "日期：____ 日期：____"}}}
	unique := Resolve(Reference{[]string{"typo"}, "乙方签字：黄亚豪"}, doc)
	if unique.Status != "verified" || unique.Candidates[0].Ranges[0].UnitID != "real" {
		t.Fatalf("exact quote repair failed: %+v", unique)
	}
	repeated := Resolve(Reference{[]string{"typo"}, "日期：____"}, doc)
	if repeated.Status != "ambiguous" || len(repeated.Candidates) != 2 {
		t.Fatal("ambiguous quote was guessed")
	}
	invented := Resolve(Reference{[]string{"typo"}, "乙方签字：黄玉豪"}, doc)
	if invented.Status != "unresolved" || len(invented.Candidates) > 0 {
		t.Fatal("invented quote accepted")
	}
}
func TestExtractMatchesCellAndHeaderOrder(t *testing.T) {
	c := sourceContract("")
	c.JSONData = map[string]any{"paragraphs": []any{
		map[string]any{"type": "header", "text": "页眉", "page": 1},
		map[string]any{"type": "table", "page": 2, "cells": []any{map[string]any{"row": 0, "col": 0, "text": "单价"}, map[string]any{"row": 0, "col": 1, "text": ""}}},
		map[string]any{"page": 3, "lines": []any{map[string]any{"spans": []any{map[string]any{"content": "日期"}, map[string]any{"content": "____"}}}}},
	}}
	doc, err := Extract(c, "left", Options{IgnoreHeaders: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Units) != 3 || doc.Units[0].BlockIdx != 1 || doc.Units[1].Text != "（空单元格）" || doc.Units[2].PageIdx != 2 || doc.Units[2].Text != "日期____" {
		t.Fatalf("extractor order: %+v", doc)
	}
}
