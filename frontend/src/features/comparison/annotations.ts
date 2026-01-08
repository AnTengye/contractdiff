// Annotation preparation for PDF/DOCX highlighting
import { contractStore, pdfActions, diffStore } from '@/store';
import { normalizeText } from '@/services/parser';
import { BLOCK_MATCH_THRESHOLD, COLORS } from '@/constants';
import type { Annotations, Annotation, BlockWithBbox } from '@/types';

/**
 * Extract blocks with bounding boxes from contract data
 */
export function extractBlocksWithBbox(side: 'left' | 'right'): BlockWithBbox[] {
  const state = contractStore.getState();
  const data = state[side].data;
  if (!data?.pdf_info) return [];

  const blocks: BlockWithBbox[] = [];

  for (const page of data.pdf_info) {
    const pageIdx = page.page_idx;
    const pageSize = page.page_size || [612, 792];

    for (const block of page.para_blocks || []) {
      if (!block.bbox) continue;

      let text = '';
      for (const line of block.lines || []) {
        for (const span of line.spans || []) {
          if (span.content) {
            text += span.content;
          }
        }
      }

      if (text.trim()) {
        blocks.push({
          text: text.trim(),
          bbox: block.bbox,
          pageIdx,
          pageSize: pageSize as [number, number],
        });
      }
    }
  }

  return blocks;
}

/**
 * Build block map for matching
 */
function buildBlockMap(blocks: BlockWithBbox[]): Map<string, BlockWithBbox[]> {
  const map = new Map<string, BlockWithBbox[]>();

  for (const block of blocks) {
    const normalized = normalizeText(block.text);
    if (!map.has(normalized)) {
      map.set(normalized, []);
    }
    map.get(normalized)!.push(block);
  }

  return map;
}

/**
 * Find matching block for diff text
 */
function findMatchingBlock(
  blockMap: Map<string, BlockWithBbox[]>,
  searchText: string
): BlockWithBbox | null {
  const normalized = normalizeText(searchText);
  if (normalized.length < 3) return null;

  // Exact match
  if (blockMap.has(normalized)) {
    return blockMap.get(normalized)![0] || null;
  }

  // Substring match
  for (const [text, blocks] of blockMap.entries()) {
    if (text.includes(normalized) || normalized.includes(text)) {
      const ratio = Math.min(text.length, normalized.length) / Math.max(text.length, normalized.length);
      if (ratio >= BLOCK_MATCH_THRESHOLD) {
        return blocks[0] || null;
      }
    }
  }

  return null;
}

/**
 * Prepare annotations from diff results
 */
export function prepareAnnotations(): void {
  const diffs = diffStore.getState().paragraphDiffs;
  if (!diffs) return;

  const leftBlocks = extractBlocksWithBbox('left');
  const rightBlocks = extractBlocksWithBbox('right');

  const leftBlockMap = buildBlockMap(leftBlocks);
  const rightBlockMap = buildBlockMap(rightBlocks);

  const leftAnnotations: Annotations = {};
  const rightAnnotations: Annotations = {};

  let pairId = 0;

  for (const diff of diffs) {
    if (!diff.hasDiff) continue;

    for (const [op, text] of diff.diffs) {
      if (op === 0 || !text.trim()) continue;

      const currentPairId = `pair-${pairId++}`;

      if (op === -1) {
        // Deletion - find in left
        const block = findMatchingBlock(leftBlockMap, text);
        if (block) {
          if (!leftAnnotations[block.pageIdx]) {
            leftAnnotations[block.pageIdx] = [];
          }
          leftAnnotations[block.pageIdx]!.push({
            bbox: block.bbox,
            pageSize: block.pageSize,
            type: 'removed',
            text: text,
            pairId: currentPairId,
          });
        }
      } else if (op === 1) {
        // Addition - find in right
        const block = findMatchingBlock(rightBlockMap, text);
        if (block) {
          if (!rightAnnotations[block.pageIdx]) {
            rightAnnotations[block.pageIdx] = [];
          }
          rightAnnotations[block.pageIdx]!.push({
            bbox: block.bbox,
            pageSize: block.pageSize,
            type: 'added',
            text: text,
            pairId: currentPairId,
          });
        }
      }
    }
  }

  pdfActions.setAnnotations(leftAnnotations, rightAnnotations);
}

/**
 * Draw annotations on PDF overlay
 */
export function drawAnnotationsOnOverlay(
  overlay: SVGSVGElement,
  annotations: Annotation[],
  scale: number
): void {
  // Clear existing annotations
  overlay.innerHTML = '';

  for (const annotation of annotations) {
    const [x0, y0, x1, y1] = annotation.bbox;
    const [, pageHeight] = annotation.pageSize;

    // Convert from PDF coordinates (bottom-left origin) to SVG (top-left origin)
    const x = x0 * scale;
    const y = (pageHeight - y1) * scale;
    const width = (x1 - x0) * scale;
    const height = (y1 - y0) * scale;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));

    const colors = annotation.type === 'added' ? COLORS.ADDED : COLORS.REMOVED;
    rect.setAttribute('fill', colors.FILL);
    rect.setAttribute('stroke', colors.STROKE);
    rect.setAttribute('stroke-width', '1');

    if (annotation.pairId) {
      rect.dataset.pairId = annotation.pairId;
    }

    overlay.appendChild(rect);
  }
}
