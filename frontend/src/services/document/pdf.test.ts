import { afterEach, expect, it, vi } from 'vitest';
import { LazyPdfRenderer, type PDFDocumentProxy, type PDFPageProxy } from './pdf';

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {} }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('bounds PDF work while page loading and rasterization are both asynchronous', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const requests = new Map<number, (page: PDFPageProxy) => void>();
  const complete = new Map<number, () => void>();
  const wrappers = new Map<number, { dataset: Record<string, string>; querySelector: () => unknown }>();
  for (let page = 1; page <= 5; page++) {
    const canvas = { width: 1, height: 1, getContext: () => ({ scale: vi.fn() }) };
    wrappers.set(page, { dataset: {}, querySelector: () => canvas });
  }
  const getPage = vi.fn((page: number) => new Promise<PDFPageProxy>((resolve) => requests.set(page, resolve)));
  const container = {
    querySelector: (selector: string) => wrappers.get(Number(selector.match(/page-num="(\d+)"/)?.[1])),
  } as unknown as HTMLElement;
  const renderer = new LazyPdfRenderer(
    { getPage } as unknown as PDFDocumentProxy,
    container,
    container,
    'left',
    1,
    vi.fn()
  );
  let active = 0, maximum = 0;
  const pending = [1, 2, 3, 4, 5].map((page) => renderer.ensurePage(page));
  // Loading a page must reserve its slot before awaiting the PDF.js request.
  expect(getPage).toHaveBeenCalledTimes(2);
  for (let start = 1; start <= 5; start += 2) {
    const pages = [start, start + 1].filter((page) => page <= 5);
    for (const page of pages) {
      requests.get(page)!({
        getViewport: () => ({ width: 595, height: 842 }),
        render: () => {
          maximum = Math.max(maximum, ++active);
          return {
            promise: new Promise<void>((resolve) => complete.set(page, () => { active--; resolve(); })),
          };
        },
      } as unknown as PDFPageProxy);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(getPage).toHaveBeenCalledTimes(Math.min(start + 1, 5));
    for (const page of pages) complete.get(page)!();
    await vi.advanceTimersByTimeAsync(20);
  }
  await Promise.all(pending);
  expect(maximum).toBe(2);
  expect(renderer.renderedPages().size).toBe(5);
});
