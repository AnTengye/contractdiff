package service

import (
	"archive/zip"
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AnTengye/contractdiff/backend/config"
)

func TestMinerUArchiveOrderDoesNotSelectDebugArtifacts(t *testing.T) {
	var buffer bytes.Buffer
	w := zip.NewWriter(&buffer)
	for _, item := range [][2]string{{"model.json", `{"debug":true}`}, {"layout.pdf", "%PDF debug annotated"}, {"middle.json", `{"pdf_info":[{"page_idx":0}]}`}, {"origin.pdf", "%PDF original"}} {
		entry, err := w.Create(item[0])
		if err != nil {
			t.Fatal(err)
		}
		if _, err = entry.Write([]byte(item[1])); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(buffer.Bytes()) }))
	defer server.Close()
	s := NewMineruService(&config.MineruConfig{})
	result, err := s.FetchZipAndExtractFiles(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if result.JSONData["pdf_info"] == nil || string(result.PDFData) != "%PDF original" {
		t.Fatal("ZIP member order selected incorrect comparison data")
	}
}

func TestMinerUArchiveJSONOnlyDoesNotRequirePDFMember(t *testing.T) {
	var buffer bytes.Buffer
	w := zip.NewWriter(&buffer)
	entry, err := w.Create("middle.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = entry.Write([]byte(`{"pdf_info":[{"page_idx":0}]}`)); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(buffer.Bytes()) }))
	defer server.Close()

	result, err := NewMineruService(&config.MineruConfig{}).FetchZipAndExtractFiles(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if result.JSONData == nil || result.PDFData != nil {
		t.Fatalf("JSON-only ZIP was not accepted as expected: %#v", result)
	}
}
