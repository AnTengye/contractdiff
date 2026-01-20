// PDF Viewer component - displays PDF pages

import { pdfStore, pdfActions, contractStore, diffStore } from '@/store';
import { loadPdfDocument, renderAllPages } from '@/services/document/pdf';
import {
  renderHighlights,
  updateCurrentHighlight,
  scrollToHighlight,
  clearHighlights,
} from '@/services/document/pdfHighlight';
import { getRequiredElement, hide, show } from '@/utils/dom';

export class PdfViewerV2 {
  private side: 'left' | 'right';
  private elements: {
    container: HTMLElement;
    pagesContainer: HTMLElement;
    placeholder: HTMLElement;
    filename: HTMLElement;
  };
  private unsubscribe: (() => void) | null = null;
  private unsubscribeDiff: (() => void) | null = null;

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

    // Subscribe to PDF store for zoom changes
    this.unsubscribe = pdfStore.subscribe((state, prevState) => {
      if (state.zoomLevel !== prevState.zoomLevel) {
        this.rerender();
      }
    });

    // Subscribe to diff store for highlight updates
    this.unsubscribeDiff = diffStore.subscribe((state, prevState) => {
      // Check if diff result changed (new comparison)
      if (state.textDiffResult !== prevState.textDiffResult && state.textDiffResult) {
        console.log(`[PdfViewer ${this.side}] Diff result changed, rendering highlights`);
        this.renderDiffHighlights(state.currentDiffIndex);
      }
      // Check if current diff index changed (navigation)
      else if (state.currentDiffIndex !== prevState.currentDiffIndex) {
        this.handleDiffIndexChange(state.currentDiffIndex, prevState.currentDiffIndex);
      }
    });
  }

  /**
   * Render diff highlights on PDF overlay
   */
  private renderDiffHighlights(currentDiffIndex: number): void {
    const diffResult = diffStore.getState().textDiffResult;
    if (!diffResult) {
      clearHighlights(this.side);
      return;
    }

    const sideResult = this.side === 'left' ? diffResult.left : diffResult.right;
    
    // Wait a bit for PDF pages to be fully rendered
    setTimeout(() => {
      renderHighlights(sideResult.segments, this.side, currentDiffIndex);
      
      // Scroll to current diff if there is one
      if (currentDiffIndex >= 0) {
        scrollToHighlight(this.side, currentDiffIndex);
      }
    }, 100);
  }

  /**
   * Handle diff index change (navigation between diffs)
   */
  private handleDiffIndexChange(newIndex: number, oldIndex: number): void {
    updateCurrentHighlight(this.side, newIndex, oldIndex);
    
    // Scroll to the new current diff
    if (newIndex >= 0) {
      scrollToHighlight(this.side, newIndex);
    }
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
    
    // Re-render highlights after PDF re-render (e.g., after zoom change)
    const diffState = diffStore.getState();
    if (diffState.textDiffResult) {
      this.renderDiffHighlights(diffState.currentDiffIndex);
    }
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.unsubscribeDiff) {
      this.unsubscribeDiff();
    }
  }
}

// Export as PdfViewer for compatibility
export { PdfViewerV2 as PdfViewer };

// Zoom controls
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
