// PDF Highlight Service - Renders diff highlights on PDF overlay
// Maps diff segments with bbox coordinates to SVG rectangles on PDF pages

import type { RenderSegment, DiffType } from '@/services/diff/textv2';
import { pdfStore } from '@/store';

// Default page size (A4 at 72 DPI) for fallback when pageSize is not available
const DEFAULT_PAGE_SIZE: [number, number] = [595, 842];

/**
 * Highlight rectangle info for tracking and navigation
 */
export interface HighlightRect {
  pageIdx: number;
  element: SVGRectElement;
  diffIndex: number;
  type: DiffType;
  bbox: [number, number, number, number];
}

/**
 * Clear all highlights from a PDF viewer
 */
export function clearHighlights(side: 'left' | 'right'): void {
  const container = document.getElementById(`pdf-pages-${side}`);
  if (!container) return;

  const overlays = container.querySelectorAll('.pdf-overlay');
  overlays.forEach(overlay => {
    overlay.innerHTML = '';
  });
}

/**
 * Render diff highlights on PDF overlay
 * @param segments - Render segments from diff engine with bbox info
 * @param side - Which side (left or right)
 * @param currentDiffIndex - Current selected diff index for highlighting
 * @returns Array of highlight rectangles for navigation
 */
export async function renderHighlights(
  segments: RenderSegment[],
  side: 'left' | 'right',
  currentDiffIndex: number = -1
): Promise<HighlightRect[]> {
  const container = document.getElementById(`pdf-pages-${side}`);
  if (!container) {
    console.warn(`[PdfHighlight] Container not found: pdf-pages-${side}`);
    return [];
  }

  clearHighlights(side);

  const zoomLevel = pdfStore.getState().zoomLevel;
  const highlights: HighlightRect[] = [];
  let diffIndex = 0;

  const pageSegments = groupSegmentsByPage(segments);

  for (const [pageIdx, segs] of pageSegments) {
    const overlay = document.getElementById(`pdf-overlay-${side}-page-${pageIdx + 1}`) as SVGSVGElement | null;
    if (!overlay) {
      console.warn(`[PdfHighlight] Overlay not found: pdf-overlay-${side}-page-${pageIdx + 1}`);
      continue;
    }

    const overlayWidth = parseFloat(overlay.getAttribute('width') || '0');
    const overlayHeight = parseFloat(overlay.getAttribute('height') || '0');

    if (overlayWidth === 0 || overlayHeight === 0) {
      console.warn(`[PdfHighlight] Overlay has zero dimensions`);
      continue;
    }

    // Merge overlapping highlights to prevent color stacking
    const { merged, nextDiffIndex } = mergeOverlappingHighlights(segs, diffIndex);
    diffIndex = nextDiffIndex;

    const pdfDoc = side === 'left' ? pdfStore.getState().leftDoc : pdfStore.getState().rightDoc;
    let pageSize: [number, number] = DEFAULT_PAGE_SIZE;
    
    if (pdfDoc) {
      try {
        const page = await pdfDoc.getPage(pageIdx + 1);
        const viewport = page.getViewport({ scale: 1.0 });
        pageSize = [viewport.width, viewport.height];
      } catch (e) {
        console.warn(`[PdfHighlight] Failed to get page info for page ${pageIdx + 1}`, e);
      }
    }

    for (const mergedHighlight of merged) {
      const finalPageSize = mergedHighlight.pageSize || pageSize;
      const isCurrentDiff = mergedHighlight.diffIndices.includes(currentDiffIndex);
      const primaryDiffIndex = mergedHighlight.diffIndices[0]!;
      
      const rect = createHighlightRect(
        mergedHighlight.bbox,
        finalPageSize,
        mergedHighlight.type,
        overlayWidth,
        overlayHeight,
        zoomLevel,
        isCurrentDiff,
        primaryDiffIndex
      );

      // Store all diff indices for navigation lookup
      rect.dataset.diffIndices = mergedHighlight.diffIndices.join(',');

      overlay.appendChild(rect);

      highlights.push({
        pageIdx,
        element: rect,
        diffIndex: primaryDiffIndex,
        type: mergedHighlight.type,
        bbox: mergedHighlight.bbox,
      });
    }
  }

  console.log(`[PdfHighlight] Rendered ${highlights.length} merged highlights on ${side} side (from ${segments.length} segments)`);
  return highlights;
}

/**
 * Create a highlight rectangle SVG element
 */
function createHighlightRect(
  bbox: [number, number, number, number],
  pageSize: [number, number],
  type: DiffType,
  overlayWidth: number,
  overlayHeight: number,
  _zoomLevel: number,
  isCurrentDiff: boolean,
  diffIndex: number
): SVGRectElement {
  const [x0, y0, x1, y1] = bbox;
  const [pageWidth, pageHeight] = pageSize;

  // Calculate scale factors from original page size to overlay size
  // The overlay size already accounts for zoom level
  const scaleX = overlayWidth / pageWidth;
  const scaleY = overlayHeight / pageHeight;

  // Transform coordinates
  const x = x0 * scaleX;
  const y = y0 * scaleY;
  const width = (x1 - x0) * scaleX;
  const height = (y1 - y0) * scaleY;

  // Create SVG rect element
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(Math.max(width, 2))); // Min width for visibility
  rect.setAttribute('height', String(Math.max(height, 4))); // Min height for visibility
  rect.setAttribute('rx', '2'); // Rounded corners
  rect.setAttribute('ry', '2');

  // Set CSS class based on type
  let className = type === 'added' ? 'highlight-added' : 'highlight-removed';
  if (isCurrentDiff) {
    className += ' highlight-current';
  }
  rect.setAttribute('class', className);
  rect.dataset.diffIndex = String(diffIndex);

  return rect;
}

/**
 * Group render segments by page index
 */
function groupSegmentsByPage(segments: RenderSegment[]): Map<number, RenderSegment[]> {
  const map = new Map<number, RenderSegment[]>();

  for (const segment of segments) {
    if (segment.pageIdx < 0) continue;

    if (!map.has(segment.pageIdx)) {
      map.set(segment.pageIdx, []);
    }
    map.get(segment.pageIdx)!.push(segment);
  }

  return map;
}

/**
 * Merged highlight info - combines overlapping segments
 */
interface MergedHighlight {
  bbox: [number, number, number, number];
  type: DiffType;
  pageSize?: [number, number];
  diffIndices: number[];  // Track all original diff indices for navigation
}

/**
 * Check if two bboxes overlap or are very close (within threshold)
 */
function bboxesOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
  threshold: number = 2
): boolean {
  const [ax0, ay0, ax1, ay1] = a;
  const [bx0, by0, bx1, by1] = b;
  
  // Check if boxes overlap or are within threshold distance
  return !(
    ax1 + threshold < bx0 ||  // a is to the left of b
    bx1 + threshold < ax0 ||  // b is to the left of a
    ay1 + threshold < by0 ||  // a is above b
    by1 + threshold < ay0     // b is above a
  );
}

/**
 * Merge two bboxes into their union
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
 * Merge overlapping highlights on the same page to prevent color stacking
 * Groups highlights by type (added/removed) and merges overlapping bboxes
 */
function mergeOverlappingHighlights(
  segments: RenderSegment[],
  startDiffIndex: number
): { merged: MergedHighlight[]; nextDiffIndex: number } {
  const merged: MergedHighlight[] = [];
  let diffIndex = startDiffIndex;
  
  // Separate by type - we only merge highlights of the same type
  const addedSegments: { segment: RenderSegment; diffIdx: number }[] = [];
  const removedSegments: { segment: RenderSegment; diffIdx: number }[] = [];
  
  for (const segment of segments) {
    if (segment.type === 'unchanged' || !segment.bbox) {
      if (segment.type !== 'unchanged') {
        diffIndex++;  // Still increment for segments without bbox
      }
      continue;
    }
    
    if (segment.type === 'added') {
      addedSegments.push({ segment, diffIdx: diffIndex });
    } else {
      removedSegments.push({ segment, diffIdx: diffIndex });
    }
    diffIndex++;
  }
  
  // Merge each type separately
  merged.push(...mergeSegmentGroup(addedSegments, 'added'));
  merged.push(...mergeSegmentGroup(removedSegments, 'removed'));
  
  // Sort by first diff index for consistent navigation
  merged.sort((a, b) => a.diffIndices[0]! - b.diffIndices[0]!);
  
  return { merged, nextDiffIndex: diffIndex };
}

/**
 * Merge a group of segments with the same type
 */
function mergeSegmentGroup(
  items: { segment: RenderSegment; diffIdx: number }[],
  type: DiffType
): MergedHighlight[] {
  if (items.length === 0) return [];
  
  const result: MergedHighlight[] = [];
  const used = new Set<number>();
  
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    
    const item = items[i]!;
    let currentBbox = [...item.segment.bbox!] as [number, number, number, number];
    const diffIndices = [item.diffIdx];
    let pageSize = item.segment.pageSize;
    
    used.add(i);
    
    // Find all overlapping segments and merge them
    let foundOverlap = true;
    while (foundOverlap) {
      foundOverlap = false;
      
      for (let j = 0; j < items.length; j++) {
        if (used.has(j)) continue;
        
        const other = items[j]!;
        if (bboxesOverlap(currentBbox, other.segment.bbox!)) {
          currentBbox = mergeBboxes(currentBbox, other.segment.bbox!);
          diffIndices.push(other.diffIdx);
          if (!pageSize && other.segment.pageSize) {
            pageSize = other.segment.pageSize;
          }
          used.add(j);
          foundOverlap = true;
        }
      }
    }
    
    result.push({
      bbox: currentBbox,
      type,
      pageSize,
      diffIndices: diffIndices.sort((a, b) => a - b),
    });
  }
  
  return result;
}

/**
 * Update current diff highlight
 * @param side - Which side
 * @param newIndex - New current diff index
 * @param oldIndex - Previous current diff index
 */
export function updateCurrentHighlight(
  side: 'left' | 'right',
  newIndex: number,
  oldIndex: number
): void {
  const container = document.getElementById(`pdf-pages-${side}`);
  if (!container) return;

  if (oldIndex >= 0) {
    const oldRect = findRectContainingDiffIndex(container, oldIndex);
    if (oldRect) {
      oldRect.classList.remove('highlight-current');
    }
  }

  if (newIndex >= 0) {
    const newRect = findRectContainingDiffIndex(container, newIndex);
    if (newRect) {
      newRect.classList.add('highlight-current');
    }
  }
}

function findRectContainingDiffIndex(container: HTMLElement, diffIndex: number): Element | null {
  let rect = container.querySelector(`rect[data-diff-index="${diffIndex}"]`);
  if (rect) return rect;
  
  const allRects = container.querySelectorAll('rect[data-diff-indices]');
  for (const r of allRects) {
    const indices = (r as HTMLElement).dataset.diffIndices?.split(',').map(Number) || [];
    if (indices.includes(diffIndex)) {
      return r;
    }
  }
  return null;
}

/**
 * Scroll to a specific diff highlight
 * @param side - Which side
 * @param diffIndex - Diff index to scroll to
 */
export function scrollToHighlight(side: 'left' | 'right', diffIndex: number): void {
  const container = document.getElementById(`pdf-pages-${side}`);
  if (!container) return;

  const rect = findRectContainingDiffIndex(container, diffIndex);
  if (rect) {
    const pageWrapper = rect.closest('.pdf-page-wrapper');
    if (pageWrapper) {
      pageWrapper.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });

      setTimeout(() => {
        rect.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        });
      }, 100);
    }
  }
}

export function getHighlightAt(side: 'left' | 'right', diffIndex: number): SVGRectElement | null {
  const container = document.getElementById(`pdf-pages-${side}`);
  if (!container) return null;

  return findRectContainingDiffIndex(container, diffIndex) as SVGRectElement | null;
}
