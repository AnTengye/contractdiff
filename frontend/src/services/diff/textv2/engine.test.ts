import { describe, it, expect } from 'vitest';
import { computeTextDiffV2 } from './engine';
import { computeDiff, ComparisonIncompleteError } from './diffComputer';
import { findSegmentsInRange } from './textExtractor';
import type { ContractData, Block } from './types';
const doc = (texts: string[]): ContractData => ({
  paragraphs: texts.map((text, index) => ({
    type: 'text',
    page: Math.floor(index / 20) + 1,
    index,
    text,
    bbox: [10, (index % 20) * 30, 500, (index % 20) * 30 + 20],
  })),
});
const roundtrip = (result: ReturnType<typeof computeTextDiffV2>) => {
  for (const side of ['left', 'right'] as const)
    expect(result[side].segments.map((s) => s.text).join('')).toBe(result[side].fullText);
};
describe('contract comparison regressions', () => {
  it.each([
    ['价款1.00元', '价款100元'],
    ['利率5%', '利率5'],
    ['金额-100元', '金额100元'],
    ['金额+100元', '金额100元'],
    ['价款1,00元', '价款100元'],
    ['金额(100)元', '金额100元'],
    ['金额十、二万元', '金额十二万元'],
    ['日期2026/10/01', '日期20261001'],
    ['A😀B', 'A😃B'],
  ])('reports critical changes: %s → %s', (a, b) => {
    for (const ignorePunctuation of [false, true]) {
      const result = computeTextDiffV2(doc([a]), doc([b]), { ignorePunctuation });
      expect(result.stats.totalChanges).toBeGreaterThan(0);
      roundtrip(result);
    }
  });
  it('keeps both originals in ignored punctuation mode', () => {
    const result = computeTextDiffV2(doc([' 甲方，乙方。']), doc(['甲方乙方']), {
      ignorePunctuation: true,
    });
    expect(result.stats.totalChanges).toBe(0);
    roundtrip(result);
  });
  it('keeps numeric parentheses significant across OCR whitespace', () => {
    const result = computeTextDiffV2(doc(['金额( 100 )元']), doc(['金额100元']), {
      ignorePunctuation: true,
    });
    expect(result.stats.totalChanges).toBeGreaterThan(0);
    roundtrip(result);
  });
  it('reports punctuation by default', () =>
    expect(
      computeTextDiffV2(doc(['甲方、乙方']), doc(['甲方乙方'])).stats.totalChanges
    ).toBeGreaterThan(0));
  it('detects a moved clause', () => {
    const result = computeTextDiffV2(
      doc(['第一条交货日期十月一日', '第二条付款金额一万元']),
      doc(['第二条付款金额一万元', '第一条交货日期十月一日'])
    );
    expect(result.stats.moves).toBe(1);
    expect(result.stats.modifications).toBe(0);
    roundtrip(result);
  });
  it('keeps unrelated deletion and insertion separate', () => {
    const result = computeTextDiffV2(doc(['苹果香蕉', '保留内容']), doc(['保留内容', '桥梁工程']));
    expect(result.stats.modifications).toBe(0);
    expect(result.stats.additions).toBe(1);
    expect(result.stats.deletions).toBe(1);
    roundtrip(result);
  });
  it('handles inserted clauses and repeated boilerplate', () => {
    const result = computeTextDiffV2(
      doc(['第一条金额100元', '合同约定', '合同约定', '第二条期限十日']),
      doc(['第一条金额200元', '新增独立段落', '合同约定', '合同约定', '第二条期限十日'])
    );
    expect(result.stats.modifications).toBe(1);
    expect(result.stats.additions).toBe(1);
    roundtrip(result);
  });
  it('handles a paragraph split across pages', () => {
    const left = doc(['第一条合同约定付款金额一万元']),
      right = doc(['第一条合同约定', '付款金额一万元']);
    right.paragraphs![1]!.page = 2;
    const result = computeTextDiffV2(left, right);
    expect(result.stats.totalChanges).toBe(0);
    roundtrip(result);
  });
  it('does not merge non-contiguous text around a moved unit', () => {
    const result = computeTextDiffV2(
      doc(['甲', '前置', '移动条款', '后置', '乙']),
      doc(['移动条款', '甲', '前后置', '乙'])
    );
    expect(result.stats.moves).toBe(1);
    const unrelatedLeftChanges = result.changes.filter(
      (change) => (change.type === 'removed' || change.operation === 'modified') && change.leftText
    );
    expect(unrelatedLeftChanges.every((change) => !change.leftText!.includes('移动条款'))).toBe(
      true
    );
    roundtrip(result);
  });
  it('compares HTML table cells', () => {
    const table = (amount: string): ContractData => ({
      paragraphs: [
        {
          type: 'table',
          page: 1,
          bbox: [0, 0, 600, 300],
          text: `<table><tr><th>总价</th><td>${amount}</td></tr></table>`,
        },
      ],
    });
    const result = computeTextDiffV2(table('10000'), table('10001'));
    expect(result.stats.modifications).toBe(1);
    expect(result.left.fullText).not.toContain('<');
    expect(result.right.segments.some((s) => s.type === 'added' && s.precision === 'block')).toBe(
      true
    );
    roundtrip(result);
  });
  it('detects changed merged-cell structure', () => {
    const table = (colspan: number): ContractData => ({
      paragraphs: [{ type: 'table', page: 1, cells: [{ row: 0, col: 0, colspan, text: '总价' }] }],
    });
    expect(computeTextDiffV2(table(1), table(2)).stats.modifications).toBe(1);
  });
  it('aligns table rows before comparing cells', () => {
    const table = (rows: string[][]): ContractData => ({
      paragraphs: [
        {
          type: 'table',
          page: 1,
          cells: rows.flatMap((row, rowIndex) =>
            row.map((text, col) => ({ row: rowIndex, col, text }))
          ),
        },
      ],
    });
    const result = computeTextDiffV2(
      table([
        ['项目', '金额'],
        ['A', '100'],
        ['B', '200'],
      ]),
      table([
        ['项目', '金额'],
        ['新增', '50'],
        ['A', '100'],
        ['B', '200'],
      ])
    );
    expect(result.stats.modifications).toBe(0);
    expect(result.stats.additions).toBe(2);
    expect(result.stats.deletions).toBe(0);
    roundtrip(result);
  });
  it('preserves character coordinates and page size', () => {
    const paragraph = (character: string): Block => ({
      type: 'text',
      page: 1,
      lines: [
        {
          bbox: [0, 0, 100, 10],
          spans: [
            {
              content: `金额${character}`,
              chars: [
                { content: '金', bbox: [0, 0, 10, 10] },
                { content: '额', bbox: [10, 0, 20, 10] },
                { content: character, bbox: [20, 0, 30, 10] },
              ],
            },
          ],
        },
      ],
    });
    const make = (s: string): ContractData => ({
      paragraphs: [paragraph(s)],
      metadata: { page_sizes: [{ page_idx: 0, width: 1000, height: 700 }] },
    });
    const result = computeTextDiffV2(make('一'), make('二'));
    const change = result.right.segments.find((s) => s.type === 'added')!;
    expect(change.bbox).toEqual([20, 0, 30, 10]);
    expect(change.pageSize).toEqual([1000, 700]);
    expect(change.precision).toBe('character');
    roundtrip(result);
  });
  it('does not merge changed boxes across lines', () => {
    const make = (a: string, b: string): ContractData => ({
      paragraphs: [
        {
          page: 1,
          lines: [
            { spans: [{ content: a, bbox: [0, 0, 100, 10] }] },
            { spans: [{ content: b, bbox: [0, 20, 100, 30] }] },
          ],
        },
      ],
    });
    expect(
      computeTextDiffV2(make('甲', '乙'), make('丙', '丁')).right.segments.filter(
        (s) => s.type === 'added'
      ).length
    ).toBe(2);
  });
  it('ignores headers only explicitly', () => {
    const a = doc(['合同正文']);
    a.paragraphs!.unshift({ type: 'header', page: 1, text: '甲公司' });
    const b = doc(['合同正文']);
    b.paragraphs!.unshift({ type: 'header', page: 1, text: '乙公司' });
    expect(computeTextDiffV2(a, b).stats.totalChanges).toBeGreaterThan(0);
    expect(computeTextDiffV2(a, b, { ignoreHeaders: true }).stats.totalChanges).toBe(0);
  });
  it('reports empty recognition and exhausted budget', () => {
    expect(() => computeTextDiffV2({ paragraphs: [] }, doc(['条款']))).toThrow('没有可比较内容');
    expect(() => computeDiff('甲'.repeat(100), '乙'.repeat(100), { maxEditLength: 1 })).toThrow(
      ComparisonIncompleteError
    );
  });
  it('shares navigation ids across replacement sides', () => {
    const result = computeTextDiffV2(doc(['金额100元']), doc(['金额200元']));
    const changed = result.changes.filter((s) => s.type !== 'unchanged');
    expect(new Set(changed.map((s) => s.diffId)).size).toBe(result.stats.totalChanges);
    expect(result.left.segments.find((s) => s.type === 'removed')!.diffId).toBe(
      result.right.segments.find((s) => s.type === 'added')!.diffId
    );
  });
  it('indexes range boundaries', () => {
    const segments = computeTextDiffV2(doc(['甲方', '乙方']), doc(['甲方', '乙方'])).left
      .textSegments;
    expect(findSegmentsInRange(segments, 3, 5).map((s) => s.text)).toEqual(['乙方']);
  });
  it('aligns long contracts with localized edits', () => {
    const left = Array.from(
        { length: 3000 },
        (_, i) => `第${i}项合同规定甲方于约定日期支付货款${i}元。`
      ),
      right = left.map((_, i) => `第${i}项合同规定甲方于约定日期支付货款${i + 1}元。`);
    const result = computeTextDiffV2(doc(left), doc(right));
    expect(result.stats.modifications).toBe(3000);
    roundtrip(result);
  }, 15000);
});
