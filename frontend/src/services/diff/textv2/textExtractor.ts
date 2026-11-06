import type {
  Block,
  ContractData,
  TextSegment,
  TextUnit,
  Bbox,
  CoordinatePrecision,
  TableCell,
} from './types';

export function extractText(
  data: ContractData,
  options: { ignoreHeaders?: boolean } = {}
): { fullText: string; segments: TextSegment[]; units: TextUnit[] } {
  const segments: TextSegment[] = [],
    units: TextUnit[] = [];
  const pageSizes = new Map<number, [number, number]>();
  for (const page of data.pdf_info ?? [])
    if (page.page_size) pageSizes.set(page.page_idx, page.page_size);
  for (const p of data.metadata?.page_sizes ?? [])
    if (p.width > 0 && p.height > 0) pageSizes.set(p.page_idx, [p.width, p.height]);
  let offset = 0,
    tableIndex = 0;
  const ignored = new Set(['header', 'footer', 'page_header', 'page_footer', 'page_number']);
  const blocks: Array<{ block: Block; pageIdx: number }> = data.paragraphs
    ? data.paragraphs.map((block) => ({ block, pageIdx: (block.page ?? 1) - 1 }))
    : [...(data.pdf_info ?? [])]
        .sort((a, b) => a.page_idx - b.page_idx)
        .flatMap((p) => (p.para_blocks ?? []).map((block) => ({ block, pageIdx: p.page_idx })));
  function addUnit(
    parts: Array<{
      text: string;
      bbox?: Bbox;
      precision: CoordinatePrecision;
      line: number;
      span: number;
    }>,
    pageIdx: number,
    blockIdx: number,
    kind: string,
    structure = ''
  ) {
    if (!parts.some((p) => p.text.trim())) return;
    const startOffset = offset;
    for (const p of parts) {
      if (!p.text) continue;
      segments.push({
        text: p.text,
        pageIdx,
        blockIdx,
        lineIdx: p.line,
        spanIdx: p.span,
        bbox: p.bbox,
        pageSize: pageSizes.get(pageIdx),
        precision: p.precision,
        startOffset: offset,
        endOffset: offset + p.text.length,
      });
      offset += p.text.length;
    }
    const text = parts.map((p) => p.text).join('');
    const clause = text
      .trim()
      .match(/^(第[零〇一二三四五六七八九十百千\d]+[条款项章节]|\d+(?:\.\d+)*[、.．)）\s])/u)?.[0]
      ?.trim();
    units.push({
      text,
      kind,
      structure,
      anchor: kind === 'cell' ? structure : clause,
      startOffset,
      endOffset: offset,
      blockIdx,
    });
    segments.push({
      text: '\n',
      pageIdx,
      blockIdx,
      lineIdx: -1,
      spanIdx: -1,
      precision: 'unknown',
      startOffset: offset,
      endOffset: offset + 1,
    });
    offset++;
  }
  blocks.forEach(({ block, pageIdx }, blockIdx) => {
    if (options.ignoreHeaders && ignored.has(block.type ?? '')) return;
    if (block.type === 'table') {
      const cells = block.cells ?? tableCellsFromHTML(findHTML(block));
      if (!cells.length) throw new Error('表格缺少可比较的单元格结构，请重新解析或提交反馈。');
      const table = tableIndex++;
      for (const cell of cells) {
        // Include spans in structure identity so a merge/split with identical text is still a change.
        addUnit(
          [
            {
              text: cell.text || '（空单元格）',
              bbox: cell.bbox ?? block.bbox,
              precision: cell.bbox ? 'cell' : block.bbox ? 'block' : 'unknown',
              line: cell.row,
              span: cell.col,
            },
          ],
          pageIdx,
          blockIdx,
          'cell',
          `${table}:${cell.row}:${cell.col}:${cell.rowspan ?? 1}:${cell.colspan ?? 1}`
        );
      }
      return;
    }
    const parts: Array<{
      text: string;
      bbox?: Bbox;
      precision: CoordinatePrecision;
      line: number;
      span: number;
    }> = [];
    function collect(b: Block) {
      if (b.blocks?.length) {
        b.blocks.forEach(collect);
        return;
      }
      if (b.lines?.length) {
        b.lines.forEach((line, lineIdx) =>
          line.spans.forEach((span, spanIdx) => {
            if (span.chars?.length && span.chars.map((c) => c.content).join('') === span.content) {
              span.chars.forEach((char) =>
                parts.push({
                  text: char.content,
                  bbox: char.bbox,
                  precision: char.bbox ? 'character' : 'unknown',
                  line: lineIdx,
                  span: spanIdx,
                })
              );
            } else {
              parts.push({
                text: span.content ?? '',
                bbox: span.bbox ?? line.bbox ?? b.bbox,
                precision: span.bbox ? 'span' : line.bbox ? 'line' : b.bbox ? 'block' : 'unknown',
                line: lineIdx,
                span: spanIdx,
              });
            }
          })
        );
      } else if (b.text)
        parts.push({ text: b.text, bbox: b.bbox, precision: b.bbox ? 'block' : 'unknown', line: 0, span: 0 });
    }
    collect(block);
    addUnit(parts, pageIdx, blockIdx, block.type ?? 'text');
  });
  return { fullText: segments.map((s) => s.text).join(''), segments, units };
}
function findHTML(block: Block): string {
  if (block.html) return block.html;
  if (block.text?.includes('<table')) return block.text;
  for (const b of block.blocks ?? []) {
    const html = findHTML(b);
    if (html) return html;
  }
  for (const line of block.lines ?? [])
    for (const span of line.spans) if (span.html) return span.html;
  return '';
}
// Compatibility for older normalized artifacts; new backend artifacts already carry cells.
export function tableCellsFromHTML(html: string): TableCell[] {
  const cells: TableCell[] = [];
  const occupied = new Set<string>();
  let row = 0;
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    let col = 0;
    for (const td of tr[1]!.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      while (occupied.has(`${row}:${col}`)) col++;
      const attr = (name: string) =>
        Math.min(
          1000,
          Math.max(
            1,
            Number(td[1]!.match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i'))?.[1] ?? 1)
          )
        );
      const rowspan = attr('rowspan'),
        colspan = attr('colspan');
      const text = td[2]!
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) =>
          String.fromCodePoint(n[0]?.toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n))
        )
        .replace(
          /&(amp|lt|gt|quot|apos|nbsp);/g,
          (_, n: string) =>
            ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n] ?? ''
        )
        .trim();
      cells.push({ row, col, rowspan, colspan, text });
      for (let r = row; r < row + rowspan; r++)
        for (let c = col; c < col + colspan; c++) occupied.add(`${r}:${c}`);
      col += colspan;
    }
    row++;
  }
  return cells;
}
export function findSegmentAtOffset(segments: TextSegment[], offset: number): TextSegment | null {
  let lo = 0,
    hi = segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (segments[mid]!.endOffset <= offset) lo = mid + 1;
    else hi = mid;
  }
  const s = segments[lo];
  return s && s.startOffset <= offset ? s : null;
}
export function findSegmentsInRange(
  segments: TextSegment[],
  startOffset: number,
  endOffset: number
): TextSegment[] {
  let lo = 0,
    hi = segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (segments[mid]!.endOffset <= startOffset) lo = mid + 1;
    else hi = mid;
  }
  const out: TextSegment[] = [];
  for (let i = lo; i < segments.length && segments[i]!.startOffset < endOffset; i++)
    out.push(segments[i]!);
  return out;
}
export function getBboxForRange(
  segments: TextSegment[],
  startOffset: number,
  endOffset: number
): { bbox: Bbox; pageIdx: number } | null {
  const found = findSegmentsInRange(segments, startOffset, endOffset).filter((s) => s.bbox);
  if (!found.length) return null;
  const first = found[0]!;
  const samePage = found.filter((s) => s.pageIdx === first.pageIdx);
  return {
    pageIdx: first.pageIdx,
    bbox: [
      Math.min(...samePage.map((s) => s.bbox![0])),
      Math.min(...samePage.map((s) => s.bbox![1])),
      Math.max(...samePage.map((s) => s.bbox![2])),
      Math.max(...samePage.map((s) => s.bbox![3])),
    ],
  };
}
