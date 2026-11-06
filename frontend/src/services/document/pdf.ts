// PDF document service
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { ZOOM } from '@/constants';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export { pdfjsLib };
export type { PDFDocumentProxy, PDFPageProxy };

/**
 * Load PDF document from URL
 * For API endpoints (starting with /api/), fetches with auth token first
 */
export async function loadPdfDocument(url: string): Promise<PDFDocumentProxy> {
  // Check if this is an API URL that needs authentication
  if (url.startsWith('/api/')) {
    const { getToken } = await import('@/utils/auth');
    const token = getToken();

    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status}`);
    }

    const data = await response.arrayBuffer();
    return loadPdfFromData(data);
  }

  // External URLs - let PDF.js handle directly
  const loadingTask = pdfjsLib.getDocument(url);
  return loadingTask.promise;
}

/**
 * Load PDF document from ArrayBuffer
 */
export async function loadPdfFromData(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjsLib.getDocument({ data });
  return loadingTask.promise;
}

/**
 * Get the effective device pixel ratio, clamped for performance
 * Higher DPR means sharper rendering but more memory usage
 */
export function getEffectivePixelRatio(): number {
  // Clamp DPR between 1 and 3 for performance reasons
  // Most screens are 1x, 1.25x, 1.5x, 2x, or 3x
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
}

/**
 * Render a PDF page to canvas
 * Handles high DPI displays by scaling canvas backing store
 */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number = ZOOM.DEFAULT
): Promise<void> {
  const dpr = getEffectivePixelRatio();
  const viewport = page.getViewport({ scale });

  // Set the CSS display size (what the user sees)
  const cssWidth = viewport.width;
  const cssHeight = viewport.height;

  // Set the canvas backing store size (actual pixels for sharp rendering)
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);

  // Set CSS size to maintain correct display dimensions
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Scale the context to account for the higher resolution backing store
  ctx.scale(dpr, dpr);

  await page.render({
    canvasContext: ctx,
    viewport: viewport,
  }).promise;
}

/**
 * Create page wrapper with canvas and SVG overlay
 * Width/height are CSS dimensions (not backing store pixels)
 */
export function createPageWrapper(
  pageNum: number,
  side: 'left' | 'right',
  cssWidth: number,
  cssHeight: number
): { wrapper: HTMLDivElement; canvas: HTMLCanvasElement; overlay: SVGSVGElement } {
  const dpr = getEffectivePixelRatio();

  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-page-wrapper';
  wrapper.dataset.pageNum = String(pageNum);
  wrapper.style.width = `${cssWidth}px`;
  wrapper.style.height = `${cssHeight}px`;
  wrapper.style.position = 'relative';

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.className = 'pdf-canvas';

  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('width', String(cssWidth));
  overlay.setAttribute('height', String(cssHeight));
  overlay.style.width = `${cssWidth}px`;
  overlay.style.height = `${cssHeight}px`;
  overlay.setAttribute('class', 'pdf-overlay');
  overlay.dataset.pageNum = String(pageNum);
  overlay.id = `pdf-overlay-${side}-page-${pageNum}`;

  wrapper.appendChild(canvas);
  wrapper.appendChild(overlay);

  return { wrapper, canvas, overlay };
}

/**
 * Render single PDF page
 */
export async function renderSinglePage(
  pdfDoc: PDFDocumentProxy,
  pageNum: number,
  side: 'left' | 'right',
  zoomLevel: number
): Promise<HTMLDivElement> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: zoomLevel });

  const { wrapper, canvas } = createPageWrapper(pageNum, side, viewport.width, viewport.height);

  await renderPageToCanvas(page, canvas, zoomLevel);

  return wrapper;
}

/**
 * Render all pages for a PDF document
 */
export async function renderAllPages(
  pdfDoc: PDFDocumentProxy,
  container: HTMLElement,
  side: 'left' | 'right',
  zoomLevel: number
): Promise<void> {
  container.innerHTML = '';

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const pageWrapper = await renderSinglePage(pdfDoc, pageNum, side, zoomLevel);
    container.appendChild(pageWrapper);
  }
}

/** Retain placeholder geometry for navigation; rasterize only nearby pages with a bounded cache. */
export class LazyPdfRenderer {
  private observer: IntersectionObserver | null = null;
  private generation = 0;
  private visible = new Set<number>();
  private tasks = new Map<number, ReturnType<PDFPageProxy['render']>>();
  private rendered = new Map<number, number>();
  private pending = new Map<number, Promise<void>>();
  private rasterizing = 0;
  private sourceSizes = new Map<number, [number, number]>();
  private zoom: number;
  private mounted = false;
  private destroyed = false;
  constructor(
    private doc: PDFDocumentProxy,
    private container: HTMLElement,
    private root: HTMLElement,
    private side: 'left' | 'right',
    zoom: number,
    private onRendered: (page: number) => void
  ) {
    this.zoom = zoom;
  }
  async mount(): Promise<void> {
    const generation = this.generation;
    this.mounted = false;
    this.destroyed = false;
    try {
      this.container.replaceChildren();
      const fragment = document.createDocumentFragment();
      for (let page = 1; page <= this.doc.numPages; page++) {
        const pdfPage = await this.doc.getPage(page);
        if (generation !== this.generation) return;
        const source = pdfPage.getViewport({ scale: 1 });
        this.sourceSizes.set(page, [source.width, source.height]);
        const wrapper = createPageWrapper(
          page,
          this.side,
          source.width * this.zoom,
          source.height * this.zoom
        );
        wrapper.canvas.width = 1;
        wrapper.canvas.height = 1;
        wrapper.wrapper.dataset.rendered = 'false';
        fragment.appendChild(wrapper.wrapper);
      }
      if (generation !== this.generation) return;
      this.container.appendChild(fragment);
      // A zoom event may arrive while getPage() is still resolving. It must
      // update the final geometry, but must not invalidate this mount.
      this.resizePageWrappers(this.zoom);
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.pageNum);
            if (entry.isIntersecting) {
              this.visible.add(page);
              void this.ensurePage(page);
            } else this.visible.delete(page);
          }
          this.evict();
        },
        { root: this.root, rootMargin: '600px 0px' }
      );
      this.container
        .querySelectorAll('.pdf-page-wrapper')
        .forEach((el) => this.observer!.observe(el));
      this.mounted = true;
      await this.ensurePage(1);
    } finally {
      if (this.destroyed) this.mounted = false;
    }
  }
  async ensurePage(page: number): Promise<void> {
    if (this.rendered.has(page)) {
      this.rendered.set(page, performance.now());
      return;
    }
    const existing = this.pending.get(page);
    if (existing) return existing;
    const generation = this.generation;
    const work = (async () => {
      // Bound simultaneous rasterization while fast scrolling.
      while (this.rasterizing >= 2 && generation === this.generation)
        await new Promise((resolve) => setTimeout(resolve, 20));
      if (generation !== this.generation) return;
      this.rasterizing++;
      try {
        const wrapper = this.container.querySelector<HTMLElement>(
          `[data-page-num="${page}"].pdf-page-wrapper`
        );
        const canvas = wrapper?.querySelector('canvas');
        if (!canvas || !wrapper) return;
        const pdfPage = await this.doc.getPage(page);
        if (generation !== this.generation) return;
        const view = pdfPage.getViewport({ scale: this.zoom }),
          dpr = getEffectivePixelRatio();
        canvas.width = Math.floor(view.width * dpr);
        canvas.height = Math.floor(view.height * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        const task = pdfPage.render({ canvasContext: ctx, viewport: view });
        this.tasks.set(page, task);
        try {
          await task.promise;
          if (generation !== this.generation) return;
          wrapper.dataset.rendered = 'true';
          this.rendered.set(page, performance.now());
          this.onRendered(page);
          this.evict();
        } catch (error) {
          if (generation === this.generation) {
            wrapper.dataset.rendered = 'false';
            wrapper.dataset.renderError = 'true';
            console.warn('PDF page render failed', error);
          }
        } finally {
          if (this.tasks.get(page) === task) this.tasks.delete(page);
        }
      } finally {
        if (generation === this.generation) this.rasterizing--;
      }
    })();
    this.pending.set(page, work);
    try {
      await work;
    } finally {
      if (this.pending.get(page) === work) this.pending.delete(page);
    }
  }
  setZoom(zoom: number): void {
    this.zoom = zoom;
    // mount() owns the in-progress fragment. It will apply the latest zoom
    // after all page geometry has been collected.
    if (!this.mounted) return;
    this.generation++;
    this.rasterizing = 0;
    for (const task of this.tasks.values()) task.cancel();
    this.tasks.clear();
    this.pending.clear();
    this.rendered.clear();
    this.resizePageWrappers(zoom);
    void this.ensurePage(1);
    for (const page of this.visible) void this.ensurePage(page);
  }
  renderedPages(): Set<number> {
    return new Set([...this.rendered.keys()].map((p) => p - 1));
  }
  private evict(): void {
    const candidates = [...this.rendered].sort((a, b) => a[1] - b[1]);
    for (const [page] of candidates) {
      if (this.rendered.size <= 8) break;
      if (this.visible.has(page) || this.tasks.has(page)) continue;
      const wrapper = this.container.querySelector<HTMLElement>(
        `[data-page-num="${page}"].pdf-page-wrapper`
      );
      const canvas = wrapper?.querySelector('canvas');
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
        wrapper!.dataset.rendered = 'false';
        wrapper!.querySelector('svg')?.replaceChildren();
      }
      this.rendered.delete(page);
    }
  }
  private resizePageWrappers(zoom: number): void {
    for (const [page, size] of this.sourceSizes) {
      const wrapper = this.container.querySelector<HTMLElement>(
        `[data-page-num="${page}"].pdf-page-wrapper`
      );
      if (!wrapper) continue;
      const width = size[0] * zoom,
        height = size[1] * zoom;
      wrapper.style.width = `${width}px`;
      wrapper.style.height = `${height}px`;
      wrapper.dataset.rendered = 'false';
      const canvas = wrapper.querySelector('canvas');
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      const overlay = wrapper.querySelector('svg');
      if (overlay) {
        overlay.setAttribute('width', String(width));
        overlay.setAttribute('height', String(height));
        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
        overlay.replaceChildren();
      }
    }
  }
  destroy(): void {
    this.generation++;
    this.destroyed = true;
    this.mounted = false;
    this.rasterizing = 0;
    this.observer?.disconnect();
    for (const task of this.tasks.values()) task.cancel();
    this.tasks.clear();
    this.container.replaceChildren();
  }
}
