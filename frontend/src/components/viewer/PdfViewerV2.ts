// PDF Viewer component - displays PDF pages

import {
  pdfStore,
  pdfActions,
  contractStore,
  diffStore,
  diffActions,
  uiStore,
  uiActions,
} from '@/store';
import { loadPdfDocument, LazyPdfRenderer } from '@/services/document/pdf';
import {
  renderHighlights,
  updateCurrentHighlight,
  scrollToHighlight,
  clearHighlights,
} from '@/services/document/pdfHighlight';
import { cancelComparison } from '@/features/comparison/comparisonV3';
import { getRequiredElement, hide, show } from '@/utils/dom';

export class PdfViewerV2 {
  private side: 'left' | 'right';
  private elements: {
    container: HTMLElement;
    pagesContainer: HTMLElement;
    placeholder: HTMLElement;
    filename: HTMLElement;
  };
  private lazy: LazyPdfRenderer | null = null;
  private loadGeneration = 0;
  private unsubscribeContract: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeDiff: (() => void) | null = null;

  constructor(side: 'left' | 'right') {
    this.side = side;
    this.elements = this.initElements();
    this.subscribeToStore();
    this.initScrollListener();
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
    this.unsubscribeContract = contractStore.subscribe((state, prevState) => {
      const sideState = state[this.side];
      const prevSideState = prevState[this.side];

      if (sideState.pdfUrl !== prevSideState.pdfUrl && !sideState.pdfUrl) {
        this.loadGeneration++;
        this.lazy?.destroy();
        this.lazy = null;
        clearHighlights(this.side);
        const old =
          this.side === 'left' ? pdfStore.getState().leftDoc : pdfStore.getState().rightDoc;
        if (this.side === 'left') pdfActions.setLeftDoc(null);
        else pdfActions.setRightDoc(null);
        if (old) void old.destroy();
        show(this.elements.placeholder);
      }
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
        this.lazy?.setZoom(state.zoomLevel);
      }
    });

    // Subscribe to diff store for highlight updates
    this.unsubscribeDiff = diffStore.subscribe((state, prevState) => {
      // Check if diff result changed (new comparison)
      if (state.textDiffResult !== prevState.textDiffResult) {
        console.log(`[PdfViewer ${this.side}] Diff result changed, rendering highlights`);
        void this.handleDiffIndexChange(state.currentDiffIndex, -1);
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
  private async renderDiffHighlights(currentDiffIndex: number): Promise<void> {
    const diffResult = diffStore.getState().textDiffResult;
    if (!diffResult) {
      clearHighlights(this.side);
      return;
    }

    const sideResult = this.side === 'left' ? diffResult.left : diffResult.right;

    await renderHighlights(
      sideResult.segments,
      this.side,
      currentDiffIndex,
      this.lazy?.renderedPages()
    );
  }

  /**
   * Handle diff index change (navigation between diffs)
   */
  private async handleDiffIndexChange(newIndex: number, oldIndex: number): Promise<void> {
    updateCurrentHighlight(this.side, newIndex, oldIndex);

    // Scroll to the new current diff
    if (newIndex >= 0) {
      const result = diffStore.getState().textDiffResult;
      const target = (this.side === 'left' ? result?.left : result?.right)?.segments.find(
        (s) => s.diffId === newIndex && s.bbox
      );
      if (target) {
        await this.lazy?.ensurePage(target.pageIdx + 1);
        const page = this.elements.pagesContainer.querySelector(
          `[data-page-num="${target.pageIdx + 1}"].pdf-page-wrapper`
        );
        if (page) {
          const bounds = page.getBoundingClientRect();
          const container = this.elements.container;
          container.scrollTop += bounds.top - container.getBoundingClientRect().top;
        }
        await this.renderDiffHighlights(newIndex);
      } else {
        await this.renderDiffHighlights(newIndex);
      }
      scrollToHighlight(this.side, newIndex);
    }
  }

  private async loadPdf(url: string): Promise<void> {
    const { placeholder, pagesContainer, filename } = this.elements;
    const generation = ++this.loadGeneration;
    this.lazy?.destroy();
    this.lazy = null;

    try {
      // Show loading state
      placeholder.classList.add('loading');
      const p = placeholder.querySelector('p');
      if (p) p.textContent = '正在加载 PDF...';
      filename.textContent = '加载中...';

      const pdfDoc = await loadPdfDocument(url);
      if (generation !== this.loadGeneration) {
        await pdfDoc.destroy();
        return;
      }

      // Store document reference
      if (this.side === 'left') {
        pdfActions.setLeftDoc(pdfDoc);
      } else {
        pdfActions.setRightDoc(pdfDoc);
      }

      const metadata = contractStore.getState()[this.side].data?.metadata;
      const parsedPages = metadata?.parser_page_count ?? metadata?.page_count;
      if (typeof parsedPages === 'number' && parsedPages < pdfDoc.numPages) {
        cancelComparison();
        diffActions.setError('解析结果页数少于原件，本次比对未完成，请重新解析或反馈遗漏页。');
      }

      // Hide placeholder, show container
      placeholder.classList.remove('loading');
      hide(placeholder);
      show(pagesContainer);

      // Render all pages
      this.lazy = new LazyPdfRenderer(
        pdfDoc,
        pagesContainer,
        this.elements.container,
        this.side,
        pdfStore.getState().zoomLevel,
        (page) => {
          const state = diffStore.getState();
          const result =
            this.side === 'left' ? state.textDiffResult?.left : state.textDiffResult?.right;
          if (result)
            void renderHighlights(
              result.segments,
              this.side,
              state.currentDiffIndex,
              new Set([page - 1])
            );
        }
      );
      await this.lazy.mount();

      // A comparison may have completed while the PDF was mounting. Re-run
      // the current navigation after wrappers and observers exist so a first
      // diff on a later page is not left for manual discovery.
      const currentDiff = diffStore.getState();
      if (currentDiff.textDiffResult && currentDiff.currentDiffIndex >= 0) {
        await this.handleDiffIndexChange(currentDiff.currentDiffIndex, -1);
      }

      if (generation === this.loadGeneration) filename.textContent = '✓ PDF 已加载';
    } catch (err) {
      if (generation !== this.loadGeneration) return;
      console.error(`Failed to load PDF for ${this.side}:`, err);
      placeholder.classList.remove('loading');
      const p = placeholder.querySelector('p');
		if (p) p.textContent = '⚠ PDF 预览校验/加载失败，请重新上传或提交反馈';
      filename.textContent = '加载失败';
    }
  }

  private initScrollListener(): void {
    this.elements.container.addEventListener('scroll', this.handleScroll);
  }

  private handleScroll = () => {
    const { syncScrollEnabled, isSyncing } = uiStore.getState();
    if (!syncScrollEnabled || isSyncing) return;

    const myContainer = this.elements.container;
    const otherSide = this.side === 'left' ? 'right' : 'left';
    const otherContainer = document.getElementById(`pdf-viewer-${otherSide}`);

    if (!otherContainer) return;

    // Set syncing flag to prevent circular updates
    uiActions.setIsSyncing(true);

    // Calculate percentage
    const maxScroll = myContainer.scrollHeight - myContainer.clientHeight;
    if (maxScroll <= 0) {
      uiActions.setIsSyncing(false);
      return;
    }

    const percentage = myContainer.scrollTop / maxScroll;

    // Apply to other container
    const otherMaxScroll = otherContainer.scrollHeight - otherContainer.clientHeight;
    if (otherMaxScroll > 0) {
      otherContainer.scrollTop = percentage * otherMaxScroll;
    }

    // Release lock after a short delay
    setTimeout(() => {
      uiActions.setIsSyncing(false);
    }, 50);
  };

  destroy(): void {
    this.loadGeneration++;
    this.lazy?.destroy();
    this.unsubscribeContract?.();
    if (this.elements.container) {
      this.elements.container.removeEventListener('scroll', this.handleScroll);
    }
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
