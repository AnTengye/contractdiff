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

  const { wrapper, canvas } = createPageWrapper(
    pageNum,
    side,
    viewport.width,
    viewport.height
  );

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
