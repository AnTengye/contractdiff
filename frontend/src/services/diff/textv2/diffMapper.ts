// Diff mapper - maps diff results back to original document coordinates
// Creates render segments with position information for display

import type {
  DiffChange,
  TextSegment,
  RenderSegment,
} from './types';
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

  for (const change of changes) {
    // Determine if this change applies to this side
    const startOffset = side === 'left' ? change.leftStartOffset : change.rightStartOffset;
    const endOffset = side === 'left' ? change.leftEndOffset : change.rightEndOffset;

    // Skip changes that don't apply to this side
    if (startOffset === undefined || endOffset === undefined) {
      // For additions on left side or removals on right side, we might want to show a placeholder
      if (side === 'left' && change.type === 'added') {
        // Don't show additions on left side (they only exist on right)
        continue;
      }
      if (side === 'right' && change.type === 'removed') {
        // Don't show removals on right side (they only exist on left)
        continue;
      }
      continue;
    }

    // Find all segments that overlap with this change
    const overlappingSegments = findSegmentsInRange(segments, startOffset, endOffset);

    if (overlappingSegments.length === 0) {
      // No matching segments, create a render segment without position info
      renderSegments.push({
        text: change.text,
        type: change.type,
        pageIdx: -1,
      });
      continue;
    }

    // Split the change text according to segment boundaries
    let changeOffset = 0;
    
    for (const segment of overlappingSegments) {
      // Calculate the overlap between change and segment
      const overlapStart = Math.max(startOffset, segment.startOffset);
      const overlapEnd = Math.min(endOffset, segment.endOffset);
      
      if (overlapStart >= overlapEnd) continue;

      // Extract the overlapping text
      const textStart = overlapStart - startOffset;
      const textEnd = overlapEnd - startOffset;
      const text = change.text.substring(textStart, textEnd);

      if (text) {
        renderSegments.push({
          text,
          type: change.type,
          pageIdx: segment.pageIdx,
          bbox: segment.bbox,
          pageSize: segment.pageSize,
        });
      }

      changeOffset = textEnd;
    }

    // Handle any remaining text that didn't map to segments
    if (changeOffset < change.text.length) {
      const remainingText = change.text.substring(changeOffset);
      const lastSegment = overlappingSegments[overlappingSegments.length - 1];
      
      renderSegments.push({
        text: remainingText,
        type: change.type,
        pageIdx: lastSegment?.pageIdx ?? -1,
        bbox: lastSegment?.bbox,
        pageSize: lastSegment?.pageSize,
      });
    }
  }

  return renderSegments;
}

/**
 * Group render segments by page for easier rendering
 */
export function groupSegmentsByPage(
  segments: RenderSegment[]
): Map<number, RenderSegment[]> {
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
 * Merge adjacent render segments with the same type and page
 * This creates cleaner output for rendering
 */
export function mergeAdjacentRenderSegments(
  segments: RenderSegment[]
): RenderSegment[] {
  if (segments.length <= 1) return segments;

  const merged: RenderSegment[] = [];
  let current = { ...segments[0]! };

  for (let i = 1; i < segments.length; i++) {
    const next = segments[i]!;

    // Merge if same type and same page
    if (current.type === next.type && current.pageIdx === next.pageIdx) {
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
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
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
