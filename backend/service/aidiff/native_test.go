package aidiff

import (
	"archive/zip"
	"bytes"
	"testing"
)

func wordFixture(t *testing.T, runXML string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	z := zip.NewWriter(&buffer)
	for name, body := range map[string]string{
		"word/document.xml": `<w:document xmlns:w="` + wordNamespace + `"><w:body><w:p><w:pPr><w:pStyle w:val="Bold"/></w:pPr>` + runXML + `</w:p></w:body></w:document>`,
		"word/styles.xml":   `<w:styles xmlns:w="` + wordNamespace + `"><w:style w:styleId="Normal" w:default="1" w:type="paragraph"/><w:style w:styleId="Bold" w:type="paragraph"><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:u w:val="single"/></w:rPr></w:style></w:styles>`,
	} {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
func TestNativeStyleInheritanceAndExplicitOff(t *testing.T) {
	left, err := readNative(wordFixture(t, `<w:r><w:t>合同金额</w:t></w:r>`))
	if err != nil {
		t.Fatal(err)
	}
	right, err := readNative(wordFixture(t, `<w:r><w:rPr><w:b w:val="0"/><w:u w:val="none"/></w:rPr><w:t>合同金额</w:t></w:r>`))
	if err != nil {
		t.Fatal(err)
	}
	ldoc, _ := Extract(sourceContract("合同金额"), "left", Options{})
	rdoc, _ := Extract(sourceContract("合同金额"), "right", Options{})
	findings := compareNative(left, right, map[string]Document{"left": ldoc, "right": rdoc})
	if len(findings) != 2 || findings[0].Category != "format" || findings[0].Before.Status != "verified" {
		t.Fatalf("styles lost: %+v", findings)
	}
	if len(compareNative(append(left, left...), right, map[string]Document{"left": ldoc, "right": rdoc})) != 0 {
		t.Fatal("repeated paragraphs paired arbitrarily")
	}
}
