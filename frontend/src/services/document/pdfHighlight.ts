import type { RenderSegment, DiffType } from '@/services/diff/textv2';
import { pdfStore } from '@/store';
export interface HighlightRect {
  pageIdx: number;
  element: SVGRectElement;
  diffIndex: number;
  type: DiffType;
  bbox: [number, number, number, number];
}
export function clearHighlights(side: 'left' | 'right'): void {
  document
    .querySelectorAll(`#pdf-pages-${side} .pdf-overlay`)
    .forEach((el) => el.replaceChildren());
}
export async function renderHighlights(
  segments: RenderSegment[],
  side: 'left' | 'right',
  currentDiffIndex = -1,
  pages?: Set<number>
): Promise<HighlightRect[]> {
  const out: HighlightRect[] = [];
  const byPage = new Map<number, RenderSegment[]>();
  for (const s of segments) {
    if (
      s.type === 'unchanged' ||
      !s.bbox ||
      s.diffId === undefined ||
      s.pageIdx < 0 ||
      (pages && !pages.has(s.pageIdx))
    )
      continue;
    const group = byPage.get(s.pageIdx) ?? [];
    group.push(s);
    byPage.set(s.pageIdx, group);
  }
  const targets = pages ?? new Set(segments.map((s) => s.pageIdx));
  for (const pageIdx of targets)
    document.getElementById(`pdf-overlay-${side}-page-${pageIdx + 1}`)?.replaceChildren();
  for (const [pageIdx, segs] of byPage) {
    const overlay = document.getElementById(`pdf-overlay-${side}-page-${pageIdx + 1}`);
    if (!overlay || overlay.parentElement?.dataset.rendered !== 'true') continue;
    const width = Number(overlay.getAttribute('width')),
      height = Number(overlay.getAttribute('height'));
    let sourceSize: [number, number] | undefined;
    const seen = new Set<string>();
    for (const s of segs) {
      const key = `${s.diffId}:${s.type}:${s.bbox!.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let pageSize = s.pageSize;
      if (!pageSize) {
        const doc = side === 'left' ? pdfStore.getState().leftDoc : pdfStore.getState().rightDoc;
        if (!sourceSize && doc) {
          const p = await doc.getPage(pageIdx + 1);
          const view = p.getViewport({ scale: 1 });
          sourceSize = [view.width, view.height];
        }
        pageSize = sourceSize;
      }
      if (!pageSize) continue;
      // Exact source geometries are preserved; no character boxes are fabricated from a block.
      const [x0, y0, x1, y1] = s.bbox!;
      if (
        ![x0, y0, x1, y1, ...pageSize].every(Number.isFinite) ||
        pageSize[0] <= 0 ||
        pageSize[1] <= 0 ||
        x1 < x0 ||
        y1 < y0
      )
        continue;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String((x0 * width) / pageSize[0]));
      rect.setAttribute('y', String((y0 * height) / pageSize[1]));
      rect.setAttribute('width', String(Math.max(2, ((x1 - x0) * width) / pageSize[0])));
      rect.setAttribute('height', String(Math.max(3, ((y1 - y0) * height) / pageSize[1])));
      rect.setAttribute(
        'class',
        `highlight-${s.type}${s.diffId === currentDiffIndex ? ' highlight-current' : ''}`
      );
      rect.dataset.diffIndex = String(s.diffId);
      rect.dataset.precision = s.precision ?? 'unknown';
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent =
        s.precision === 'block' ? '此处仅有区域坐标，双击反馈定位问题' : '双击反馈此处差异';
      rect.appendChild(title);
      rect.addEventListener('dblclick', () =>
        document.dispatchEvent(
          new CustomEvent('feedback-diff', { detail: { diffId: s.diffId, side } })
        )
      );
      overlay.appendChild(rect);
      out.push({ pageIdx, element: rect, diffIndex: s.diffId!, type: s.type, bbox: s.bbox! });
    }
  }
  return out;
}
export function updateCurrentHighlight(
  side: 'left' | 'right',
  newIndex: number,
  _oldIndex: number
): void {
  document
    .querySelectorAll<SVGRectElement>(`#pdf-pages-${side} rect[data-diff-index]`)
    .forEach((rect) =>
      rect.classList.toggle('highlight-current', rect.dataset.diffIndex === String(newIndex))
    );
}
export function getHighlightAt(side: 'left' | 'right', diffIndex: number): SVGRectElement | null {
  return document.querySelector(`#pdf-pages-${side} rect[data-diff-index="${diffIndex}"]`);
}
export function scrollToHighlight(side: 'left' | 'right', diffIndex: number): void {
  const highlight = getHighlightAt(side, diffIndex);
  const container = document.getElementById(`pdf-viewer-${side}`);
  if (!highlight || !container) return;
  const bounds = highlight.getBoundingClientRect();
  container.scrollTo({
    top:
      container.scrollTop +
      bounds.top -
      container.getBoundingClientRect().top -
      (container.clientHeight - bounds.height) / 2,
    behavior: 'smooth',
  });
}
