package aidiff

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/png"
	"testing"

	"github.com/AnTengye/contractdiff/backend/config"
)

type visualFake struct{}

func (visualFake) Compare(context.Context, Input) (ModelResult, error) {
	return ModelResult{}, errors.New("文字服务不可用")
}
func (visualFake) VisualCompare(_ context.Context, docs map[string]Document, _ VisualRequest) (ModelResult, error) {
	l, r := docs["left"].Units[0], docs["right"].Units[0]
	return ModelResult{Complete: true, Differences: []ModelFinding{{Kind: "modified", Summary: "下划线取消", Before: Reference{[]string{l.ID}, l.Text}, After: Reference{[]string{r.ID}, r.Text}}}}, nil
}
func testImage(t *testing.T) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			img.Set(x, y, color.RGBA{uint8(x * 7), uint8(y * 7), uint8(x * y), 255})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}
func TestVisualReviewDoesNotHideFailedTextOrClaimWholeDocument(t *testing.T) {
	s := New(config.AIDiffConfig{APIKey: "test-only"}, nil)
	defer s.Close()
	s.completer = visualFake{}
	job, err := s.Start("tenant/user", sourceContract("合同金额"), sourceContract("合同金额"), Options{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	awaitFinished(t, s, "tenant/user", job.ID)
	images := VisualRequest{Left: PageImage{1, testImage(t)}, Right: PageImage{1, testImage(t)}}
	if _, err := s.StartVisual("other/user", job.ID, images); err == nil {
		t.Fatal("cross-owner visual review")
	}
	bad := images
	bad.Left.PageIdx = 99
	if _, err := s.StartVisual("tenant/user", job.ID, bad); err == nil {
		t.Fatal("unreferenced page accepted")
	}
	if _, err := s.StartVisual("tenant/user", job.ID, images); err != nil {
		t.Fatal(err)
	}
	result := awaitFinished(t, s, "tenant/user", job.ID)
	if result.Status != "partial" || result.TextStatus != "failed" || result.FormatStatus != "partial" || len(result.VisualPages) != 1 || len(result.Findings) != 1 || result.Findings[0].Before.Status != "verified" {
		t.Fatalf("visual completion overwrote independent status: %+v", result)
	}
}
