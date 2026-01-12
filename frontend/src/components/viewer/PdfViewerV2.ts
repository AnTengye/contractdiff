// PDF Viewer V2 component - supports new visual annotations

import { pdfStore, pdfActions, contractStore } from '@/store';
import { loadPdfDocument, renderAllPages } from '@/services/document/pdf';
import { prepareAnnotations, drawAnnotationsOnOverlay } from '@/features/comparison';
import { getRequiredElement, hide, show } from '@/utils/dom';
import { COLORS } from '@/constants';
import type { Annotations } from '@/types';
import type { VisualAnnotation } from '@/services/diff/visual';

export class PdfViewerV2 {
  private side: 'left' | 'right';
  private elements: {
    container: HTMLElement;
    pagesContainer: HTMLElement;
    placeholder: HTMLElement;
    filename: HTMLElement;
  };
  private unsubscribe: (() => void) | null = null;

  constructor(side: 'left' | 'right') {
    this.side = side;
    this.elements = this.initElements();
    this.subscribeToStore();
  }

  private initElements() {
    return {
      container: getRequiredElement(`pdf-viewer-${this.side}`),
      pagesContainer: getRequiredElement(`pdf-pages-${this.side}`),
      placeholder: getRequiredElement(`pdf-placeholder-${this.side}`),
      filename: getRequiredElement(`pdf-filename-${this.side}`),
    };
  }

  private subscribeToStore(): void {
    // Subscribe to contract store for URL changes
    contractStore.subscribe((state, prevState) => {
      const sideState = state[this.side];
      const prevSideState = prevState[this.side];

      if (sideState.pdfUrl !== prevSideState.pdfUrl && sideState.pdfUrl) {
        console.log(`[PdfViewer ${this.side}] Loading PDF:`, sideState.pdfUrl);
        this.loadPdf(sideState.pdfUrl);
      }
    });

    // Check if pdfUrl is already set
    const currentState = contractStore.getState()[this.side];
    if (currentState.pdfUrl) {
      console.log(`[PdfViewer ${this.side}] Initial pdfUrl found:`, currentState.pdfUrl);
      this.loadPdf(currentState.pdfUrl);
    }

    // Subscribe to PDF store for zoom and annotation changes
    this.unsubscribe = pdfStore.subscribe((state, prevState) => {
      if (state.zoomLevel !== prevState.zoomLevel) {
        this.rerender();
      }

      // Check if new visual annotations changed
      const visualAnnotations = this.side === 'left' 
        ? state.leftVisualAnnotations 
        : state.rightVisualAnnotations;
      const prevVisualAnnotations = this.side === 'left' 
        ? prevState.leftVisualAnnotations 
        : prevState.rightVisualAnnotations;
      
      if (visualAnnotations !== prevVisualAnnotations) {
        this.drawVisualAnnotations(visualAnnotations);
        return;
      }

      // Fall back to legacy annotations
      const annotations = this.side === 'left' ? state.leftAnnotations : state.rightAnnotations;
      const prevAnnotations = this.side === 'left' ? prevState.leftAnnotations : prevState.rightAnnotations;
      if (annotations !== prevAnnotations) {
        this.drawLegacyAnnotations(annotations);
      }
    });
  }

  private async loadPdf(url: string): Promise<void> {
    const { placeholder, pagesContainer, filename } = this.elements;

    try {
      // Show loading state
      placeholder.classList.add('loading');
      const p = placeholder.querySelector('p');
      if (p) p.textContent = '正在加载 PDF...';
      filename.textContent = '加载中...';

      const pdfDoc = await loadPdfDocument(url);

      // Store document reference
      if (this.side === 'left') {
        pdfActions.setLeftDoc(pdfDoc);
      } else {
        pdfActions.setRightDoc(pdfDoc);
      }

      // Hide placeholder, show container
      placeholder.classList.remove('loading');
      hide(placeholder);
      show(pagesContainer);

      // Render all pages
      await this.rerender();

      filename.textContent = '✓ PDF 已加载';

      // Prepare and draw annotations if we have diff results
      prepareAnnotations();
    } catch (err) {
      console.error(`Failed to load PDF for ${this.side}:`, err);
      placeholder.classList.remove('loading');
      const p = placeholder.querySelector('p');
      if (p) p.textContent = '⚠ PDF 加载失败';
      filename.textContent = '加载失败';
    }
  }

  private async rerender(): Promise<void> {
    const pdfDoc = this.side === 'left' ? pdfStore.getState().leftDoc : pdfStore.getState().rightDoc;
    if (!pdfDoc) return;

    const zoomLevel = pdfStore.getState().zoomLevel;
    await renderAllPages(pdfDoc, this.elements.pagesContainer, this.side, zoomLevel);

    // Redraw annotations (try visual first, then legacy)
    const visualAnnotations = this.side === 'left'
      ? pdfStore.getState().leftVisualAnnotations
      : pdfStore.getState().rightVisualAnnotations;
    
    if (visualAnnotations.size > 0) {
      this.drawVisualAnnotations(visualAnnotations);
    } else {
      const legacyAnnotations = this.side === 'left'
        ? pdfStore.getState().leftAnnotations
        : pdfStore.getState().rightAnnotations;
      this.drawLegacyAnnotations(legacyAnnotations);
    }
  }

  /**
   * Draw new visual annotations
   */
  private drawVisualAnnotations(annotationsMap: Map<number, VisualAnnotation[]>): void {
    const zoomLevel = pdfStore.getState().zoomLevel;

    for (const [pageIdx, annotations] of annotationsMap.entries()) {
      const pageNum = pageIdx + 1;
      const overlay = document.getElementById(`pdf-overlay-${this.side}-page-${pageNum}`) as unknown as SVGSVGElement | null;

      if (overlay && annotations) {
        this.drawVisualAnnotationsOnOverlay(overlay, annotations, zoomLevel);
      }
    }
  }

  /**
   * Draw visual annotations on SVG overlay
   */
  private drawVisualAnnotationsOnOverlay(
    overlay: SVGSVGElement,
    annotations: VisualAnnotation[],
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

      // Select colors based on annotation type
      let colors;
      switch (annotation.type) {
        case 'added':
          colors = COLORS.ADDED;
          break;
        case 'removed':
          colors = COLORS.REMOVED;
          break;
        case 'modified':
          colors = COLORS.MODIFIED;
          break;
        default:
          colors = COLORS.REMOVED;
      }

      rect.setAttribute('fill', colors.FILL);
      rect.setAttribute('stroke', colors.STROKE);
      rect.setAttribute('stroke-width', '1');

      // Store metadata
      rect.dataset.diffIndex = String(annotation.diffIndex);
      rect.dataset.charStart = String(annotation.charStart);
      rect.dataset.charEnd = String(annotation.charEnd);

      overlay.appendChild(rect);
    }
  }

  /**
   * Draw legacy annotations (for backward compatibility)
   */
  private drawLegacyAnnotations(annotations: Annotations): void {
    const zoomLevel = pdfStore.getState().zoomLevel;

    for (const [pageIdxStr, pageAnnotations] of Object.entries(annotations)) {
      const pageIdx = parseInt(pageIdxStr, 10);
      const pageNum = pageIdx + 1;
      const overlay = document.getElementById(`pdf-overlay-${this.side}-page-${pageNum}`) as unknown as SVGSVGElement | null;

      if (overlay && pageAnnotations) {
        drawAnnotationsOnOverlay(overlay, pageAnnotations, zoomLevel);
      }
    }
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}

// Export as PdfViewer for compatibility
export { PdfViewerV2 as PdfViewer };

// Zoom controls (unchanged)
export function setupZoomControls(): void {
  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  const zoomLevelSpan = document.getElementById('zoom-level');

  if (zoomInBtn && zoomOutBtn && zoomLevelSpan) {
    zoomInBtn.addEventListener('click', () => {
      pdfActions.changeZoom(0.1);
    });

    zoomOutBtn.addEventListener('click', () => {
      pdfActions.changeZoom(-0.1);
    });

    pdfStore.subscribe((state) => {
      const percentage = Math.round(state.zoomLevel * 100);
      zoomLevelSpan.textContent = `${percentage}%`;
    });
  }
}
