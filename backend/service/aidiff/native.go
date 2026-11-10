package aidiff

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/AnTengye/contractdiff/backend/model"
)

const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

type style map[string]string
type styledText struct {
	text   string
	styles []style
}
type wordStyle struct {
	basedOn string
	values  style
}

func attr(start xml.StartElement, name string) string {
	for _, a := range start.Attr {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}
func copyStyle(base style) style {
	result := style{}
	for k, v := range base {
		result[k] = v
	}
	return result
}
func styleProperty(token xml.StartElement, target style) {
	key := token.Name.Local
	val := attr(token, "val")
	switch key {
	case "b", "i", "strike", "dstrike":
		if val == "0" || val == "false" || val == "off" {
			target[key] = "无"
		} else {
			target[key] = "有"
		}
	case "u":
		if val == "none" || val == "0" {
			target[key] = "无"
		} else if val == "" || val == "single" {
			target[key] = "单线"
		} else {
			target[key] = val
		}
	case "sz":
		target[key] = val
	}
}

func zipXML(z *zip.Reader, name string) ([]byte, error) {
	for _, f := range z.File {
		if f.Name == name {
			if f.UncompressedSize64 > 16<<20 {
				return nil, errors.New("DOCX XML 过大")
			}
			r, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer r.Close()
			data, err := io.ReadAll(io.LimitReader(r, 16<<20+1))
			if len(data) > 16<<20 {
				return nil, errors.New("DOCX XML 过大")
			}
			return data, err
		}
	}
	return nil, errors.New("DOCX XML 不存在")
}

func readNative(data []byte) ([]styledText, error) {
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	document, err := zipXML(z, "word/document.xml")
	if err != nil {
		return nil, err
	}
	styles := map[string]wordStyle{}
	defaults := style{"b": "无", "i": "无", "u": "无", "strike": "无", "dstrike": "无", "sz": ""}
	defaultParagraph := ""
	if definitions, err := zipXML(z, "word/styles.xml"); err == nil {
		d := xml.NewDecoder(bytes.NewReader(definitions))
		current, inRunProperties, inDefaults := "", false, false
		for {
			token, err := d.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, err
			}
			switch t := token.(type) {
			case xml.StartElement:
				if t.Name.Space != wordNamespace {
					continue
				}
				switch t.Name.Local {
				case "docDefaults":
					inDefaults = true
				case "style":
					current = attr(t, "styleId")
					styles[current] = wordStyle{values: style{}}
					if attr(t, "type") == "paragraph" && attr(t, "default") == "1" {
						defaultParagraph = current
					}
				case "basedOn":
					if current != "" {
						s := styles[current]
						s.basedOn = attr(t, "val")
						styles[current] = s
					}
				case "rPr":
					inRunProperties = true
				default:
					if inRunProperties {
						if current != "" {
							styleProperty(t, styles[current].values)
						} else if inDefaults {
							styleProperty(t, defaults)
						}
					}
				}
			case xml.EndElement:
				if t.Name.Space != wordNamespace {
					continue
				}
				switch t.Name.Local {
				case "style":
					current = ""
				case "rPr":
					inRunProperties = false
				case "docDefaults":
					inDefaults = false
				}
			}
		}
	}
	var resolve func(string, style, map[string]bool) style
	resolve = func(id string, base style, seen map[string]bool) style {
		result := copyStyle(base)
		if seen[id] || id == "" {
			return result
		}
		seen[id] = true
		if s, ok := styles[id]; ok {
			result = resolve(s.basedOn, base, seen)
			for k, v := range s.values {
				result[k] = v
			}
		}
		return result
	}
	type run struct {
		text           strings.Builder
		direct         style
		characterStyle string
	}
	type paragraph struct {
		runs           []run
		paragraphStyle string
	}
	paragraphs := []styledText{}
	d := xml.NewDecoder(bytes.NewReader(document))
	var p *paragraph
	var r *run
	inText, inRunProperties, inParagraphProperties, deleted := false, false, false, 0
	for {
		token, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := token.(type) {
		case xml.StartElement:
			if t.Name.Space != wordNamespace {
				continue
			}
			switch t.Name.Local {
			case "del":
				deleted++
			case "p":
				if p != nil {
					return nil, errors.New("嵌套文本框暂不支持原生样式复核")
				}
				p = &paragraph{paragraphStyle: defaultParagraph}
			case "pPr":
				inParagraphProperties = true
			case "pStyle":
				if p != nil && inParagraphProperties {
					p.paragraphStyle = attr(t, "val")
				}
			case "r":
				if p != nil {
					r = &run{direct: style{}}
				}
			case "rPr":
				if r != nil {
					inRunProperties = true
				}
			case "rStyle":
				if r != nil && inRunProperties {
					r.characterStyle = attr(t, "val")
				}
			case "t":
				inText = true
			case "tab":
				if r != nil {
					r.text.WriteString("\t")
				}
			case "br":
				if r != nil {
					r.text.WriteString("\n")
				}
			default:
				if r != nil && inRunProperties {
					styleProperty(t, r.direct)
				}
			}
		case xml.CharData:
			if inText && r != nil && deleted == 0 {
				r.text.Write(t)
			}
		case xml.EndElement:
			if t.Name.Space != wordNamespace {
				continue
			}
			switch t.Name.Local {
			case "del":
				deleted--
			case "t":
				inText = false
			case "rPr":
				inRunProperties = false
			case "pPr":
				inParagraphProperties = false
			case "r":
				if p != nil && r != nil {
					p.runs = append(p.runs, *r)
					r = nil
				}
			case "p":
				if p == nil {
					continue
				}
				base := resolve(p.paragraphStyle, defaults, map[string]bool{})
				var text strings.Builder
				charStyles := []style{}
				for _, run := range p.runs {
					values := resolve(run.characterStyle, base, map[string]bool{})
					for k, v := range run.direct {
						values[k] = v
					}
					t, _, _ := compact(run.text.String())
					text.WriteString(t)
					for range []rune(t) {
						charStyles = append(charStyles, values)
					}
				}
				if text.Len() > 0 {
					paragraphs = append(paragraphs, styledText{text.String(), charStyles})
				}
				p = nil
			}
		}
	}
	return paragraphs, nil
}

func (s *Service) nativeFormats(ctx context.Context, left, right *model.Contract, docs map[string]Document) ([]Finding, error) {
	read := func(c *model.Contract) ([]styledText, error) {
		r, _, err := s.files.OpenFile(ctx, c.FileObjectKey)
		if err != nil {
			return nil, err
		}
		defer r.Close()
		data, err := io.ReadAll(io.LimitReader(r, 30<<20+1))
		if err != nil || len(data) > 30<<20 {
			return nil, errors.New("DOCX 读取失败")
		}
		return readNative(data)
	}
	l, err := read(left)
	if err != nil {
		return nil, err
	}
	r, err := read(right)
	if err != nil {
		return nil, err
	}
	return compareNative(l, r, docs), nil
}

func compareNative(left, right []styledText, docs map[string]Document) []Finding {
	findings := []Finding{}
	li, ri := map[string][]styledText{}, map[string][]styledText{}
	for _, p := range left {
		li[p.text] = append(li[p.text], p)
	}
	for _, p := range right {
		ri[p.text] = append(ri[p.text], p)
	}
	labels := map[string]string{"b": "加粗", "i": "斜体", "u": "下划线", "strike": "删除线", "dstrike": "双删除线", "sz": "字号（半磅）"}
	for _, l := range left {
		// Repeated paragraphs are not paired by occurrence: leave them to review.
		if len(li[l.text]) != 1 || len(ri[l.text]) != 1 {
			continue
		}
		r := ri[l.text][0]
		chars := []rune(l.text)
		if len(l.styles) != len(r.styles) {
			continue
		}
		for _, property := range []string{"b", "i", "u", "strike", "dstrike", "sz"} {
			for start := 0; start < len(chars); {
				before, after := l.styles[start][property], r.styles[start][property]
				if before == after {
					start++
					continue
				}
				end := start + 1
				for end < len(chars) && l.styles[end][property] == before && r.styles[end][property] == after {
					end++
				}
				quote := string(chars[max(0, start-8):min(len(chars), end+8)])
				bl := Resolve(referenceForQuote(quote, docs["left"]), docs["left"])
				al := Resolve(referenceForQuote(quote, docs["right"]), docs["right"])
				findings = append(findings, Finding{ID: fmt.Sprintf("native-%d", len(findings)), Category: "format", Kind: "modified", Summary: labels[property] + "：" + before + " → " + after, Before: bl, After: al, Source: "native_style"})
				start = end
			}
		}
	}
	return findings
}
