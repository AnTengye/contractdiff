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
 * Render a PDF page to canvas
 */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number = ZOOM.DEFAULT
): Promise<void> {
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  await page.render({
    canvasContext: ctx,
    viewport: viewport,
  }).promise;
}

/**
 * Create page wrapper with canvas and SVG overlay
 */
export function createPageWrapper(
  pageNum: number,
  side: 'left' | 'right',
  width: number,
  height: number
): { wrapper: HTMLDivElement; canvas: HTMLCanvasElement; overlay: SVGSVGElement } {
  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-page-wrapper';
  wrapper.dataset.pageNum = String(pageNum);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.className = 'pdf-canvas';

  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('width', String(width));
  overlay.setAttribute('height', String(height));
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
