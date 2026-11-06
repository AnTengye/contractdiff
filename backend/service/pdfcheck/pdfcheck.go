package pdfcheck

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"strings"
	"unicode"

	"github.com/ledongthuc/pdf"
)

const DefaultMaxBytes int64 = 50 << 20

type Options struct {
	MaxBytes    int64
	TextSample  string
	RequireText bool
}

type PageInfo struct {
	Index    int
	Width    float64
	Height   float64
	Rotation int
	CropBox  [4]float64
}

type Info struct {
	SHA256    string
	Size      int64
	PageCount int
	Pages     []PageInfo
	Text      string
	TextChars int
}

type box struct {
	x0, y0, x1, y1 float64
}

// Validate checks both the PDF envelope and the readable page structure.
// A header-only check is intentionally insufficient for parser and preview
// inputs because it accepts HTML/error bodies renamed to .pdf.
func Validate(data []byte, options Options) (info Info, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			info = Info{}
			err = fmt.Errorf("PDF structure is unreadable: %v", recovered)
		}
	}()
	if len(data) == 0 {
		return info, fmt.Errorf("PDF is empty")
	}
	maxBytes := options.MaxBytes
	if maxBytes <= 0 {
		maxBytes = DefaultMaxBytes
	}
	if int64(len(data)) > maxBytes {
		return info, fmt.Errorf("PDF exceeds maximum size of %d bytes", maxBytes)
	}
	if len(data) < 9 || !bytes.HasPrefix(data, []byte("%PDF-1.")) {
		return info, fmt.Errorf("invalid PDF header")
	}

	sum := sha256.Sum256(data)
	info = Info{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(data))}
	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Info{}, fmt.Errorf("PDF structure is unreadable: %w", err)
	}
	info.PageCount = reader.NumPage()
	if info.PageCount <= 0 {
		return Info{}, fmt.Errorf("PDF contains no pages")
	}

	var text strings.Builder
	for pageIndex := 1; pageIndex <= info.PageCount; pageIndex++ {
		page := reader.Page(pageIndex)
		if page.V.IsNull() {
			return Info{}, fmt.Errorf("PDF page %d is unreadable", pageIndex)
		}
		pageInfo, pageErr := inspectPage(page, pageIndex-1)
		if pageErr != nil {
			return Info{}, pageErr
		}
		info.Pages = append(info.Pages, pageInfo)

		pageText, contentErr := page.GetPlainText(nil)
		if contentErr != nil {
			return Info{}, fmt.Errorf("PDF page %d content is unreadable: %w", pageIndex, contentErr)
		}
		text.WriteString(pageText)
	}
	info.Text = strings.TrimSpace(text.String())
	info.TextChars = len([]rune(info.Text))
	if options.RequireText && info.TextChars == 0 {
		return Info{}, fmt.Errorf("PDF has no readable text layer")
	}
	if sample := normalized(options.TextSample); sample != "" && !strings.Contains(normalized(info.Text), sample) {
		return Info{}, fmt.Errorf("PDF text layer does not contain the source text sample")
	}
	return info, nil
}

func inspectPage(page pdf.Page, index int) (PageInfo, error) {
	media, err := inheritedBox(page, "MediaBox")
	if err != nil {
		return PageInfo{}, fmt.Errorf("PDF page %d has invalid MediaBox: %w", index+1, err)
	}
	if media == nil {
		return PageInfo{}, fmt.Errorf("PDF page %d has no MediaBox", index+1)
	}
	crop, err := inheritedBox(page, "CropBox")
	if err != nil {
		return PageInfo{}, fmt.Errorf("PDF page %d has invalid CropBox: %w", index+1, err)
	}
	if crop == nil {
		crop = media
	}
	if crop.x0 < media.x0-0.01 || crop.y0 < media.y0-0.01 ||
		crop.x1 > media.x1+0.01 || crop.y1 > media.y1+0.01 {
		return PageInfo{}, fmt.Errorf("PDF page %d CropBox is outside MediaBox", index+1)
	}
	rotationValue := inherited(page, "Rotate")
	rotation := 0
	if !rotationValue.IsNull() {
		rotation = int(rotationValue.Int64())
	}
	rotation = ((rotation % 360) + 360) % 360
	if rotation%90 != 0 {
		return PageInfo{}, fmt.Errorf("PDF page %d has unsupported rotation %d", index+1, rotation)
	}
	width, height := crop.x1-crop.x0, crop.y1-crop.y0
	if rotation == 90 || rotation == 270 {
		width, height = height, width
	}
	return PageInfo{
		Index: index, Width: width, Height: height, Rotation: rotation,
		CropBox: [4]float64{crop.x0, crop.y0, crop.x1, crop.y1},
	}, nil
}

func inherited(page pdf.Page, key string) pdf.Value {
	for value := page.V; !value.IsNull(); value = value.Key("Parent") {
		if item := value.Key(key); !item.IsNull() {
			return item
		}
	}
	return pdf.Value{}
}

func inheritedBox(page pdf.Page, key string) (*box, error) {
	value := inherited(page, key)
	if value.IsNull() {
		return nil, nil
	}
	if value.Kind() != pdf.Array || value.Len() < 4 {
		return nil, fmt.Errorf("%s is not a four-number array", key)
	}
	values := [4]float64{value.Index(0).Float64(), value.Index(1).Float64(), value.Index(2).Float64(), value.Index(3).Float64()}
	if !finite(values[0]) || !finite(values[1]) || !finite(values[2]) || !finite(values[3]) ||
		values[2] <= values[0] || values[3] <= values[1] {
		return nil, fmt.Errorf("%s has invalid bounds", key)
	}
	return &box{x0: values[0], y0: values[1], x1: values[2], y1: values[3]}, nil
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func normalized(value string) string {
	return strings.ToLower(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, value))
}
