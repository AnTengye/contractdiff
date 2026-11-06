// Diff mapper - maps diff results back to original document coordinates
// Creates render segments with position information for display

import type { DiffChange, TextSegment, RenderSegment } from './types';
import { findSegmentsInRange } from './textExtractor';

/**
 * Map diff changes to render segments for one side (left or right)
 */
export function mapChangesToSegments(
  changes: DiffChange[],
  segments: TextSegment[],
  side: 'left' | 'right'
): RenderSegment[] {
  const renderSegments: RenderSegment[] = [];
  const relevant = changes
    .filter((c) => (side === 'left' ? c.leftStartOffset : c.rightStartOffset) !== undefined)
    .sort((a, b) =>
      side === 'left'
        ? a.leftStartOffset! - b.leftStartOffset!
        : a.rightStartOffset! - b.rightStartOffset!
    );
  let cursor = 0;
  const end = segments[segments.length - 1]?.endOffset ?? 0;
  function append(start: number, finish: number, type: RenderSegment['type'], diffId?: number) {
    for (const segment of findSegmentsInRange(segments, start, finish)) {
      const lo = Math.max(start, segment.startOffset),
        hi = Math.min(finish, segment.endOffset);
      if (lo >= hi) continue;
      renderSegments.push({
        text: segment.text.slice(lo - segment.startOffset, hi - segment.startOffset),
        type,
        diffId,
        pageIdx: segment.pageIdx,
        blockIdx: segment.blockIdx,
        bbox: segment.bbox,
        pageSize: segment.pageSize,
        precision: segment.precision,
      });
    }
  }
  for (const change of relevant) {
    const start = side === 'left' ? change.leftStartOffset! : change.rightStartOffset!;
    const finish = side === 'left' ? change.leftEndOffset! : change.rightEndOffset!;
    if (start > cursor) append(cursor, start, 'unchanged');
    append(start, finish, change.type, change.diffId);
    cursor = Math.max(cursor, finish);
  }
  if (cursor < end) append(cursor, end, 'unchanged');
  return renderSegments;
}

/**
 * Group render segments by page for easier rendering
 */
export function groupSegmentsByPage(segments: RenderSegment[]): Map<number, RenderSegment[]> {
  const pageMap = new Map<number, RenderSegment[]>();

  for (const segment of segments) {
    const pageIdx = segment.pageIdx;

    if (!pageMap.has(pageIdx)) {
      pageMap.set(pageIdx, []);
    }

    pageMap.get(pageIdx)!.push(segment);
  }

  return pageMap;
}

/**
 * Merge adjacent render segments with the same type, page, and block
 * This creates cleaner output for rendering
 */
export function mergeAdjacentRenderSegments(segments: RenderSegment[]): RenderSegment[] {
  if (segments.length <= 1) return segments;

  const merged: RenderSegment[] = [];
  let current = { ...segments[0]! };

  for (let i = 1; i < segments.length; i++) {
    const next = segments[i]!;

    // Merge if same type, same page, and same block
    if (
      current.type === next.type &&
      current.pageIdx === next.pageIdx &&
      current.blockIdx === next.blockIdx &&
      current.diffId === next.diffId &&
      current.precision === next.precision &&
      (current.type === 'unchanged' ||
        (current.bbox?.[1] === next.bbox?.[1] && current.bbox?.[3] === next.bbox?.[3]))
    ) {
      current.text += next.text;

      // Merge bbox if both have one
      if (current.bbox && next.bbox) {
        current.bbox = mergeBboxes(current.bbox, next.bbox);
      }
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
}

/**
 * Merge two bounding boxes into their union
 */
function mergeBboxes(
  a: [number, number, number, number],
  b: [number, number, number, number]
): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * Find diff indices (for navigation)
 * Returns indices of segments that have changes (not unchanged)
 */
export function findDiffIndices(segments: RenderSegment[]): number[] {
  const indices: number[] = [];

  for (let i = 0; i < segments.length; i++) {
    if (segments[i]!.type !== 'unchanged') {
      indices.push(i);
    }
  }

  return indices;
}

/**
 * Convert render segments to HTML for display
 */
export function segmentsToHtml(
  segments: RenderSegment[],
  options: {
    showPageSeparators?: boolean;
    currentDiffIndex?: number;
  } = {}
): string {
  const { showPageSeparators = true, currentDiffIndex = -1 } = options;

  let html = '';
  let lastPage = -1;
  let diffIndex = 0;

  for (const segment of segments) {
    // Add page separator if page changed
    if (showPageSeparators && segment.pageIdx !== lastPage && segment.pageIdx >= 0) {
      html += `<div class="page-separator">第 ${segment.pageIdx + 1} 页</div>`;
      lastPage = segment.pageIdx;
    }

    // Determine CSS class based on type
    let className = '';
    let isCurrentDiff = false;

    switch (segment.type) {
      case 'added':
        className = 'diff-added';
        isCurrentDiff = diffIndex === currentDiffIndex;
        diffIndex++;
        break;
      case 'removed':
        className = 'diff-removed';
        isCurrentDiff = diffIndex === currentDiffIndex;
        diffIndex++;
        break;
      case 'unchanged':
        className = 'unchanged';
        break;
    }

    if (isCurrentDiff) {
      className += ' current-diff';
    }

    // Escape HTML and render
    const escapedText = escapeHtml(segment.text);
    html += `<span class="${className}">${escapedText}</span>`;
  }

  return html || '<p class="placeholder">无内容</p>';
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}
