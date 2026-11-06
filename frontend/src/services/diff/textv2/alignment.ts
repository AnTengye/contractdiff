import { comparisonText, computeDiff, ComparisonIncompleteError } from './diffComputer';
import type { DiffComputeOptions } from './diffComputer';
import type { DiffChange, TextUnit } from './types';

interface Pair {
  left: TextUnit[];
  right: TextUnit[];
  moved?: boolean;
}
interface IndexedUnit {
  unit: TextUnit;
  index: number;
}
interface CellPosition {
  table: number;
  row: number;
  col: number;
}
interface TableRow {
  row: number;
  cells: IndexedUnit[];
}

function cellPosition(unit: TextUnit): CellPosition | null {
  if (unit.kind !== 'cell') return null;
  const parts = unit.structure.split(':').map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((value) => !Number.isInteger(value))) return null;
  return { table: parts[0]!, row: parts[1]!, col: parts[2]! };
}

function cellShape(unit: TextUnit): string | null {
  if (unit.kind !== 'cell') return null;
  const parts = unit.structure.split(':');
  if (parts.length < 5) return null;
  return `${parts[0]}:${parts[2]}:${parts[3]}:${parts[4]}`;
}

function tableRows(units: TextUnit[]): Map<number, TableRow[]> {
  const tables = new Map<number, Map<number, IndexedUnit[]>>();
  units.forEach((unit, index) => {
    const position = cellPosition(unit);
    if (!position) return;
    const rows = tables.get(position.table) ?? new Map<number, IndexedUnit[]>();
    const cells = rows.get(position.row) ?? [];
    cells.push({ unit, index });
    rows.set(position.row, cells);
    tables.set(position.table, rows);
  });
  return new Map(
    [...tables].map(([table, rows]) => [
      table,
      [...rows]
        .sort(([a], [b]) => a - b)
        .map(([row, cells]) => ({
          row,
          cells: cells.sort(
            (a, b) => (cellPosition(a.unit)?.col ?? 0) - (cellPosition(b.unit)?.col ?? 0)
          ),
        })),
    ])
  );
}

function rowText(row: TableRow, options: DiffComputeOptions): string {
  return row.cells
    .map((cell) => `${cellPosition(cell.unit)?.col ?? -1}=${comparisonText(cell.unit.text, options)}`)
    .join('\u0001');
}

function rowMatchScore(left: TableRow, right: TableRow, options: DiffComputeOptions): number {
  const rightColumns = new Set(right.cells.map((cell) => cellPosition(cell.unit)?.col));
  const sharedColumns = left.cells.filter((cell) => rightColumns.has(cellPosition(cell.unit)?.col)).length;
  if (sharedColumns === 0) return -3;
  const shapeScore = sharedColumns / Math.max(left.cells.length, right.cells.length);
  return 0.75 + shapeScore + similar(rowText(left, options), rowText(right, options));
}

function alignTableRows(
  left: TextUnit[],
  right: TextUnit[],
  options: DiffComputeOptions,
  budget: () => void,
  matches: Map<number, number>,
  usedRight: Set<number>,
  exact: Set<number>
): void {
  const leftTables = tableRows(left);
  const rightTables = tableRows(right);
  const tableIndexes = new Set([...leftTables.keys(), ...rightTables.keys()]);
  const gapPenalty = -1.2;

  for (const table of tableIndexes) {
    const leftRows = leftTables.get(table) ?? [];
    const rightRows = rightTables.get(table) ?? [];
    const dp = Array.from({ length: leftRows.length + 1 }, () =>
      Array<number>(rightRows.length + 1).fill(0)
    );
    for (let i = 1; i <= leftRows.length; i++) dp[i]![0] = i * gapPenalty;
    for (let j = 1; j <= rightRows.length; j++) dp[0]![j] = j * gapPenalty;
    for (let i = 1; i <= leftRows.length; i++) {
      for (let j = 1; j <= rightRows.length; j++) {
        budget();
        const score = rowMatchScore(leftRows[i - 1]!, rightRows[j - 1]!, options);
        dp[i]![j] = Math.max(
          dp[i - 1]![j - 1]! + score,
          dp[i - 1]![j]! + gapPenalty,
          dp[i]![j - 1]! + gapPenalty
        );
      }
    }

    let i = leftRows.length;
    let j = rightRows.length;
    const aligned: Array<[TableRow, TableRow]> = [];
    while (i > 0 && j > 0) {
      budget();
      const leftRow = leftRows[i - 1]!;
      const rightRow = rightRows[j - 1]!;
      const score = rowMatchScore(leftRow, rightRow, options);
      if (dp[i]![j] === dp[i - 1]![j - 1]! + score && score > 0) {
        aligned.push([leftRow, rightRow]);
        i--;
        j--;
      } else if (dp[i]![j] === dp[i - 1]![j]! + gapPenalty) {
        i--;
      } else {
        j--;
      }
    }

    for (const [leftRow, rightRow] of aligned.reverse()) {
      const rightByColumn = new Map(
        rightRow.cells.map((cell) => [cellPosition(cell.unit)?.col ?? -1, cell])
      );
      for (const leftCell of leftRow.cells) {
        const column = cellPosition(leftCell.unit)?.col ?? -1;
        const rightCell = rightByColumn.get(column);
        if (!rightCell || usedRight.has(rightCell.index)) continue;
        matches.set(leftCell.index, rightCell.index);
        usedRight.add(rightCell.index);
        if (
          cellShape(leftCell.unit) === cellShape(rightCell.unit) &&
          comparisonText(leftCell.unit.text, options) === comparisonText(rightCell.unit.text, options)
        ) {
          exact.add(leftCell.index);
        }
      }
    }
  }
}
function longestIncreasing(pairs: Array<[number, number]>): Set<number> {
  const tails: number[] = [],
    previous = new Int32Array(pairs.length).fill(-1);
  pairs.forEach((pair, i) => {
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (pairs[tails[mid]!]![1] < pair[1]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1]!;
    tails[lo] = i;
  });
  const kept = new Set<number>();
  let at = tails[tails.length - 1] ?? -1;
  while (at >= 0) {
    kept.add(pairs[at]![0]);
    at = previous[at]!;
  }
  return kept;
}
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function similar(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const x = bigrams(a),
    y = bigrams(b);
  let common = 0;
  for (const token of x) if (y.has(token)) common++;
  return x.size + y.size ? (2 * common) / (x.size + y.size) : 0;
}
function indexUnique(units: TextUnit[], key: (u: TextUnit) => string): Map<string, number> {
  const out = new Map<string, number>();
  units.forEach((u, i) => {
    const k = key(u);
    if (k) out.set(k, out.has(k) ? -1 : i);
  });
  return out;
}

export function computeAlignedDiff(
  left: TextUnit[],
  right: TextUnit[],
  leftText: string,
  rightText: string,
  options: DiffComputeOptions
): DiffChange[] {
  const deadline = Date.now() + (options.timeoutMs ?? 10000);
  const budget = () => {
    if (Date.now() >= deadline) throw new ComparisonIncompleteError();
  };
  const key = (u: TextUnit) =>
    `${u.kind === 'cell' ? 'cell:' + u.structure : 'text'}|${comparisonText(u.text, options)}`;
  const lIndex = indexUnique(left, key),
    rIndex = indexUnique(right, key);
  const matches = new Map<number, number>(),
    usedRight = new Set<number>(),
    exact = new Set<number>();
  alignTableRows(left, right, options, budget, matches, usedRight, exact);
  for (const [k, i] of lIndex) {
    const j = rIndex.get(k);
    if (k && left[i]?.kind !== 'cell' && i >= 0 && j !== undefined && j >= 0) {
      matches.set(i, j);
      usedRight.add(j);
      exact.add(i);
    }
  }
  const exactPairs = [...matches].sort((a, b) => a[0] - b[0]);
  const stationary = longestIncreasing(exactPairs);
  const moved = new Set<number>();
  for (const i of exact) if (!stationary.has(i)) moved.add(i);
  // Clause numbers and table positions anchor changed text without comparing every pair.
  const anchor = (u: TextUnit) =>
    u.kind === 'cell' ? '' : (u.anchor ?? '');
  const la = indexUnique(left, anchor),
    ra = indexUnique(right, anchor);
  const splitEquivalent = (a: TextUnit[], ai: number, b: TextUnit[], bi: number) => {
    for (let n = 2; n <= 3 && bi + n <= b.length; n++) {
      if (
        a[ai]!.kind !== 'cell' &&
        b.slice(bi, bi + n).every((u) => u.kind !== 'cell') &&
        comparisonText(a[ai]!.text, options) ===
          comparisonText(
            b
              .slice(bi, bi + n)
              .map((u) => u.text)
              .join(''),
            options
          )
      )
        return true;
    }
    return false;
  };
  for (const [k, i] of la) {
    const j = ra.get(k);
    if (
      k &&
      i >= 0 &&
      j !== undefined &&
      j >= 0 &&
      !matches.has(i) &&
      !usedRight.has(j) &&
      !splitEquivalent(left, i, right, j) &&
      !splitEquivalent(right, j, left, i)
    ) {
      matches.set(i, j);
      usedRight.add(j);
    }
  }
  const anchors = [...matches].filter(([i]) => !moved.has(i)).sort((a, b) => a[0] - b[0]);
  const monotone = longestIncreasing(anchors);
  const boundaries: Array<[number, number]> = [
    [-1, -1],
    ...anchors.filter(([i]) => monotone.has(i)),
    [left.length, right.length],
  ];
  const pairs: Pair[] = [...matches].map(([i, j]) => ({
    left: [left[i]!],
    right: [right[j]!],
    moved: moved.has(i),
  }));
  for (let b = 1; b < boundaries.length; b++) {
    budget();
    const [l0, r0] = boundaries[b - 1]!,
      [l1, r1] = boundaries[b]!;
    const ls: IndexedUnit[] = left
      .slice(l0 + 1, l1)
      .map((unit, index) => ({ unit, index: l0 + 1 + index }))
      .filter((item) => !matches.has(item.index));
    const rs: IndexedUnit[] = right
      .slice(r0 + 1, r1)
      .map((unit, index) => ({ unit, index: r0 + 1 + index }))
      .filter((item) => !usedRight.has(item.index));
    let i = 0,
      j = 0;
    while (i < ls.length || j < rs.length) {
      budget();
      if (i >= ls.length) {
        pairs.push({ left: [], right: [rs[j++]!.unit] });
        continue;
      }
      if (j >= rs.length) {
        pairs.push({ left: [ls[i++]!.unit], right: [] });
        continue;
      }
      let grouped = false;
      // Recognition/reflow may split a paragraph across pages or merge adjacent lines.
      if (ls[i]!.unit.kind !== 'cell' && rs[j]!.unit.kind !== 'cell') {
        for (let nl = 1; nl <= 3 && !grouped && i + nl <= ls.length; nl++)
          for (let nr = 1; nr <= 3 && !grouped && j + nr <= rs.length; nr++) {
            const lg = ls.slice(i, i + nl),
              rg = rs.slice(j, j + nr);
            const contiguous = (items: IndexedUnit[]) =>
              items.every((item, index) => index === 0 || item.index === items[index - 1]!.index + 1);
            if (
              lg.some((item) => item.unit.kind === 'cell') ||
              rg.some((item) => item.unit.kind === 'cell') ||
              !contiguous(lg) ||
              !contiguous(rg)
            )
              continue;
            if (
              comparisonText(lg.map((item) => item.unit.text).join(''), options) ===
              comparisonText(rg.map((item) => item.unit.text).join(''), options)
            ) {
              pairs.push({
                left: lg.map((item) => item.unit),
                right: rg.map((item) => item.unit),
              });
              i += nl;
              j += nr;
              grouped = true;
            }
          }
      }
      if (grouped) continue;
      const l = ls[i]!.unit,
        r = rs[j]!.unit;
      const score = (a: TextUnit, c: TextUnit) =>
        a.kind === 'cell' || c.kind === 'cell'
          ? 0
          : similar(comparisonText(a.text, options), comparisonText(c.text, options));
      const current = score(l, r);
      let best = current,
        bestL = i,
        bestR = j;
      for (let d = 1; d <= 8; d++) {
        if (i + d < ls.length) {
          const s = score(ls[i + d]!.unit, r);
          if (s > best) {
            best = s;
            bestL = i + d;
            bestR = j;
          }
        }
        if (j + d < rs.length) {
          const s = score(l, rs[j + d]!.unit);
          if (s > best) {
            best = s;
            bestL = i;
            bestR = j + d;
          }
        }
      }
      if (best >= 0.35) {
        while (i < bestL) pairs.push({ left: [ls[i++]!.unit], right: [] });
        while (j < bestR) pairs.push({ left: [], right: [rs[j++]!.unit] });
        pairs.push({ left: [ls[i++]!.unit], right: [rs[j++]!.unit] });
      } else {
        pairs.push({ left: [ls[i++]!.unit], right: [] });
        pairs.push({ left: [], right: [rs[j++]!.unit] });
      }
    }
  }
  const changes: DiffChange[] = [];
  let nextId = 0;
  for (const pair of pairs) {
    budget();
    const lFirst = pair.left[0],
      rFirst = pair.right[0];
    const lEnd = pair.left[pair.left.length - 1]?.endOffset,
      rEnd = pair.right[pair.right.length - 1]?.endOffset;
    const l = lFirst ? leftText.slice(lFirst.startOffset, lEnd) : '',
      r = rFirst ? rightText.slice(rFirst.startOffset, rEnd) : '';
    if (pair.moved) {
      changes.push({
        type: 'moved',
        text: l,
        leftText: l,
        rightText: r,
        leftStartOffset: lFirst!.startOffset,
        leftEndOffset: lEnd,
        rightStartOffset: rFirst!.startOffset,
        rightEndOffset: rEnd,
        diffId: nextId++,
      });
      continue;
    }
    if (!lFirst) {
      changes.push({
        type: 'added',
        text: r,
        rightText: r,
        rightStartOffset: rFirst!.startOffset,
        rightEndOffset: rEnd,
        diffId: nextId++,
      });
      continue;
    }
    if (!rFirst) {
      changes.push({
        type: 'removed',
        text: l,
        leftText: l,
        leftStartOffset: lFirst.startOffset,
        leftEndOffset: lEnd,
        diffId: nextId++,
      });
      continue;
    }
    if (lFirst.kind === 'cell' && cellShape(lFirst) !== cellShape(rFirst)) {
      const diffId = nextId++;
      changes.push(
        {
          type: 'removed',
          text: l,
          leftText: l,
          leftStartOffset: lFirst.startOffset,
          leftEndOffset: lEnd,
          diffId,
        },
        {
          type: 'added',
          text: r,
          rightText: r,
          rightStartOffset: rFirst.startOffset,
          rightEndOffset: rEnd,
          diffId,
        }
      );
      continue;
    }
    const local = computeDiff(l, r, {
      ...options,
      timeoutMs: Math.max(1, deadline - Date.now()),
    }).changes;
    const hasChanges = local.some((c) => c.type !== 'unchanged');
    const groupId = hasChanges ? nextId++ : undefined;
    for (const change of local) {
      if (change.leftStartOffset !== undefined) change.leftStartOffset += lFirst.startOffset;
      if (change.leftEndOffset !== undefined) change.leftEndOffset += lFirst.startOffset;
      if (change.rightStartOffset !== undefined) change.rightStartOffset += rFirst.startOffset;
      if (change.rightEndOffset !== undefined) change.rightEndOffset += rFirst.startOffset;
      if (change.type !== 'unchanged') {
        change.diffId = groupId;
        change.operation = 'modified';
      }
      changes.push(change);
    }
  }
  return changes;
}
