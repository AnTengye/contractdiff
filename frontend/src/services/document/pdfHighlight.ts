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
export function renderHighlights(
  segments: RenderSegment[],
  side: 'left' | 'right',
  currentDiffIndex: number = -1
): HighlightRect[] {
  const container = document.getElementById(`pdf-pages-${side}`);
  if (!container) {
    console.warn(`[PdfHighlight] Container not found: pdf-pages-${side}`);
    return [];
  }

  // Clear existing highlights
  clearHighlights(side);

  const zoomLevel = pdfStore.getState().zoomLevel;
  const highlights: HighlightRect[] = [];
  let diffIndex = 0;

  // Group segments by page for efficient rendering
  const pageSegments = groupSegmentsByPage(segments);

  for (const [pageIdx, segs] of pageSegments) {
    // Find overlay for this page (1-indexed page number)
    const overlay = document.getElementById(`pdf-overlay-${side}-page-${pageIdx + 1}`) as SVGSVGElement | null;
    if (!overlay) {
      console.warn(`[PdfHighlight] Overlay not found: pdf-overlay-${side}-page-${pageIdx + 1}`);
      continue;
    }

    // Get page size from overlay dimensions
    const overlayWidth = parseFloat(overlay.getAttribute('width') || '0');
    const overlayHeight = parseFloat(overlay.getAttribute('height') || '0');

    if (overlayWidth === 0 || overlayHeight === 0) {
      console.warn(`[PdfHighlight] Overlay has zero dimensions`);
      continue;
    }

    for (const segment of segs) {
      // Skip unchanged segments
      if (segment.type === 'unchanged') continue;

      // Skip segments without bbox
      if (!segment.bbox) {
        diffIndex++;
        continue;
      }

      // Use default page size if not provided
      const pageSize = segment.pageSize || DEFAULT_PAGE_SIZE;

      const isCurrentDiff = diffIndex === currentDiffIndex;
      const rect = createHighlightRect(
        segment.bbox,
        pageSize,
        segment.type,
        overlayWidth,
        overlayHeight,
        zoomLevel,
        isCurrentDiff,
        diffIndex
      );

      overlay.appendChild(rect);

      highlights.push({
        pageIdx: segment.pageIdx,
        element: rect,
        diffIndex,
        type: segment.type,
        bbox: segment.bbox,
      });

      diffIndex++;
    }
  }

  console.log(`[PdfHighlight] Rendered ${highlights.length} highlights on ${side} side`);
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

  // Remove current class from old highlight
  if (oldIndex >= 0) {
    const oldRect = container.querySelector(`rect[data-diff-index="${oldIndex}"]`);
    if (oldRect) {
      oldRect.classList.remove('highlight-current');
    }
  }

  // Add current class to new highlight
  if (newIndex >= 0) {
    const newRect = container.querySelector(`rect[data-diff-index="${newIndex}"]`);
    if (newRect) {
      newRect.classList.add('highlight-current');
    }
  }
}

/**
 * Scroll to a specific diff highlight
 * @param side - Which side
 * @param diffIndex - Diff index to scroll to
 */
export function scrollToHighlight(side: 'left' | 'right', diffIndex: number): void {
  const container = document.getElementById(`pdf-pages-${side}`);
  if (!container) return;

  const rect = container.querySelector(`rect[data-diff-index="${diffIndex}"]`);
  if (rect) {
    // Get the page wrapper containing this highlight
    const pageWrapper = rect.closest('.pdf-page-wrapper');
    if (pageWrapper) {
      pageWrapper.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });

      // Additional scroll to center the specific highlight
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

/**
 * Get highlight at a specific diff index
 */
export function getHighlightAt(side: 'left' | 'right', diffIndex: number): SVGRectElement | null {
  const container = document.getElementById(`pdf-pages-${side}`);
  if (!container) return null;

  return container.querySelector(`rect[data-diff-index="${diffIndex}"]`);
}
