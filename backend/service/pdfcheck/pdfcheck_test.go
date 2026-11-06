package pdfcheck

import (
	"bytes"
	"fmt"
	"testing"
)

func testPDF(text string) []byte {
	content := fmt.Sprintf("BT /F1 12 Tf 10 50 Td (%s) Tj ET", text)
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	return testPDFObjects(objects)
}

func testPDFObjects(objects []string) []byte {
	var data bytes.Buffer
	data.WriteString("%PDF-1.4\n")
	offsets := []int{0}
	for index, object := range objects {
		offsets = append(offsets, data.Len())
		fmt.Fprintf(&data, "%d 0 obj\n%s\nendobj\n", index+1, object)
	}
	xrefOffset := data.Len()
	fmt.Fprintf(&data, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&data, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&data, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xrefOffset)
	return data.Bytes()
}

func TestValidateChecksReadableStructureAndTextLayer(t *testing.T) {
	data := testPDF("Known Sample")
	info, err := Validate(data, Options{TextSample: "Known Sample", RequireText: true})
	if err != nil {
		t.Fatalf("valid PDF rejected: %v", err)
	}
	if info.PageCount != 1 || info.TextChars == 0 || info.SHA256 == "" {
		t.Fatalf("unexpected PDF info: %#v", info)
	}
	if info.Pages[0].Width != 200 || info.Pages[0].Height != 100 {
		t.Fatalf("unexpected page geometry: %#v", info.Pages[0])
	}
}

func TestValidateRejectsHeaderOnlyAndOversizedPDF(t *testing.T) {
	if _, err := Validate([]byte("%PDF-1.7\nnot a PDF"), Options{}); err == nil {
		t.Fatal("header-only body was accepted")
	}
	data := testPDF("sample")
	if _, err := Validate(data, Options{MaxBytes: int64(len(data) - 1)}); err == nil {
		t.Fatal("oversized PDF was accepted")
	}
}

func TestValidateRejectsMissingTextSample(t *testing.T) {
	if _, err := Validate(testPDF("actual text"), Options{TextSample: "missing", RequireText: true}); err == nil {
		t.Fatal("PDF without the known text sample was accepted")
	}
}

func TestValidateRejectsWhitespaceOnlyTextLayer(t *testing.T) {
	if _, err := Validate(testPDF("   "), Options{RequireText: true}); err == nil {
		t.Fatal("PDF with only whitespace was accepted as readable text")
	}
}

func TestValidateDecodesIdentityHTextUsingToUnicode(t *testing.T) {
	content := "BT /F1 12 Tf 10 50 Td <00010002000300040005> Tj ET"
	cmap := `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
5 beginbfchar
<0001> <5408>
<0002> <540C>
<0003> <5DF2>
<0004> <786E>
<0005> <8BA4>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end end`
	data := testPDFObjects([]string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content),
		"<< /Type /Font /Subtype /Type0 /BaseFont /NotoSansCJK /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
		"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSansCJK /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(cmap), cmap),
	})
	info, err := Validate(data, Options{TextSample: "合同已确认", RequireText: true})
	if err != nil {
		t.Fatalf("valid Chinese text rejected: %v", err)
	}
	if info.Text != "合同已确认" {
		t.Fatalf("unexpected decoded text: %q", info.Text)
	}
	if _, err := Validate(data, Options{TextSample: "合同未确认", RequireText: true}); err == nil {
		t.Fatal("Chinese PDF with a different source text sample was accepted")
	}
}
