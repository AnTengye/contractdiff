// PDF Viewer component
import { pdfStore, pdfActions, contractStore } from '@/store';
import { loadPdfDocument, renderAllPages } from '@/services/document/pdf';
import { prepareAnnotations, drawAnnotationsOnOverlay } from '@/features/comparison';
import { getRequiredElement, hide, show } from '@/utils/dom';
import { ZOOM } from '@/constants';
import type { Annotations } from '@/types';

export class PdfViewer {
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

      console.log(`[PdfViewer ${this.side}] pdfUrl changed:`, prevSideState.pdfUrl, '->', sideState.pdfUrl);

      if (sideState.pdfUrl !== prevSideState.pdfUrl && sideState.pdfUrl) {
        console.log(`[PdfViewer ${this.side}] Loading PDF:`, sideState.pdfUrl);
        this.loadPdf(sideState.pdfUrl);
      }
    });

    // Check if pdfUrl is already set (in case data was loaded before component initialized)
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

      // Check if annotations changed
      const annotations = this.side === 'left' ? state.leftAnnotations : state.rightAnnotations;
      const prevAnnotations = this.side === 'left' ? prevState.leftAnnotations : prevState.rightAnnotations;
      if (annotations !== prevAnnotations) {
        this.drawAnnotations(annotations);
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

    // Redraw annotations
    const annotations = this.side === 'left'
      ? pdfStore.getState().leftAnnotations
      : pdfStore.getState().rightAnnotations;
    this.drawAnnotations(annotations);
  }

  private drawAnnotations(annotations: Annotations): void {
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

// Zoom controls
export function setupZoomControls(): void {
  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  const zoomLevelSpan = document.getElementById('zoom-level');

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      pdfActions.changeZoom(ZOOM.STEP);
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      pdfActions.changeZoom(-ZOOM.STEP);
    });
  }

  // Update zoom level display
  pdfStore.subscribe((state) => {
    if (zoomLevelSpan) {
      zoomLevelSpan.textContent = `${Math.round(state.zoomLevel * 100)}%`;
    }
  });
}
