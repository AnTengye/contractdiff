---
name: PaddleOCR Troubleshooting
description: Diagnoses and troubleshoots contractdiff diffing engine and coordinate alignment issues related to PaddleOCR VL layouts.
---

# PaddleOCR Troubleshooting Skill

This skill provides a systematic approach to diagnosing and resolving issues in the ContractDiff engine where text differences fail to align correctly and coordinate highlights unexpectedly cover the entire page when using the `paddleocr` parser.

## Background Context
The ContractDiff comparison engine relies heavily on fine-grained, line-level or short paragraph-level bounding boxes (bboxes). These are critical for:
1. **Accurate Diffing:** The two-stage diff algorithm (paragraph alignment -> character diff) requires reasonably sized chunks. Huge chunks cause misalignment.
2. **Accurate Highlighting:** The frontend PDF canvas expects coordinates bounding actual text lines.

PaddleOCR-VL-1.5 handles layout processing through the `UseLayoutDetection` parameter:
- **`true` (Classical Layout):** Crops the page into fine-grained fragments (text, tables). Returns precise bounding boxes and properly chunks text. **Required** for the Diff engine to function correctly.
- **`false` (Native VL Multimodal):** Uses the VL model to natively recognize full-page multi-modal structures (retaining cross-page tables and title hierarchies). However, it outputs the **entire page as a single `ocr` block** with a bounding box spanning `[0, 0, pageWidth, pageHeight]`. This destroys the granularity necessary for the contract comparison engine.

## Step-by-Step Troubleshooting

### 1. Verify Backend Configuration
Check `backend/config.yaml` and `backend/config/config.go`.
Look for `use_layout_detection` under `paddleocr`. If it is set to `false` or commented out (which defaults to `false` in the Go config layer), this is the root cause of the whole-page coordinate issue.

### 2. Run Diagnostic Script
Use the provided Node.js diagnostic script to hit the local API and verify the parsed output structure.

```bash
node .agents/skills/paddleocr_troubleshooting/scripts/test_parser.js <path_to_pdf>
```

The script will upload the PDF to the local backend at `http://localhost:28080`, poll for completion, and analyze the resulting paragraphs.
- If the script outputs `[WARN] Page X only has ONE paragraph covering the entire page!`, then layout detection is missing or disabled.

### 3. Apply Resolution
To restore proper diffing and accurate coordinate highlights, modify the active `backend/config.yaml`:

```yaml
parsers:
  paddleocr:
    enabled: true
    use_layout_detection: true # Explicitly enforce layout detection
```
*Note: Setting this to `true` trades off the advanced PaddleOCR VL cross-page table merge capabilities in favor of strict Diff engine accuracy. If cross-page table merging is strictly required, the backend's `NormalizeResult` function will need a structural overhaul to synthetically chunk the markdown and extrapolate precise line bounding boxes.*
