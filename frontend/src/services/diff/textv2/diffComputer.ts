import * as Diff from 'diff';
import type { DiffChange, DiffStats } from './types';

export interface DiffComputeOptions {
  charLevel?: boolean;
  wordLevel?: boolean;
  ignoreWhitespace?: boolean;
  ignorePunctuation?: boolean;
  ignoreCase?: boolean;
  timeoutMs?: number;
  maxEditLength?: number;
}
// Contract-significant symbols (decimal points, signs, percentages, separators) survive every mode.
const OPTIONAL_PUNCTUATION = new Set(
  Array.from('、。，；：！？“”‘’【】「」『』（）《》〈〉,;:!?"\'()[]{}')
);
const NUMERIC_CONTEXT = /[\p{N}零〇一二三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟萬億]/u;
function hasNumericContext(chars: string[], index: number, direction: -1 | 1): boolean {
  for (let next = index + direction; next >= 0 && next < chars.length; next += direction) {
    if (/\s/u.test(chars[next]!)) continue;
    return NUMERIC_CONTEXT.test(chars[next]!);
  }
  return false;
}
function ignoreChar(
  char: string,
  options: DiffComputeOptions,
  before = '',
  after = '',
  numericBefore = NUMERIC_CONTEXT.test(before),
  numericAfter = NUMERIC_CONTEXT.test(after)
): boolean {
  return Boolean(
    (options.ignoreWhitespace !== false && /\s/u.test(char)) ||
      (options.ignorePunctuation &&
        OPTIONAL_PUNCTUATION.has(char) &&
        !numericBefore &&
        !numericAfter)
  );
}
export function comparisonText(text: string, options: DiffComputeOptions = {}): string {
  const chars = Array.from(text);
  return chars
    .filter(
      (c, index) =>
        !ignoreChar(
          c,
          options,
          chars[index - 1],
          chars[index + 1],
          hasNumericContext(chars, index, -1),
          hasNumericContext(chars, index, 1)
        )
    )
    .join('');
}
export class ComparisonIncompleteError extends Error {
  constructor(message = '文档差异较大，计算达到上限；本次比对未完成，请缩小文档范围后重试。') {
    super(message);
    this.name = 'ComparisonIncompleteError';
  }
}
function normalize(
  text: string,
  options: DiffComputeOptions
): { text: string; positions: number[] } {
  let normalized = '';
  const positions: number[] = [];
  let offset = 0;
  const chars = Array.from(text);
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]!;
    if (
      !ignoreChar(
        char,
        options,
        chars[index - 1],
        chars[index + 1],
        hasNumericContext(chars, index, -1),
        hasNumericContext(chars, index, 1)
      )
    ) {
      for (let i = 0; i < char.length; i++) positions.push(offset + i);
      normalized += char;
    }
    offset += char.length;
  }
  positions.push(text.length);
  return { text: normalized, positions };
}
export function computeDiff(
  leftText: string,
  rightText: string,
  options: DiffComputeOptions = {}
): { changes: DiffChange[]; stats: DiffStats } {
  const left = normalize(leftText, options),
    right = normalize(rightText, options);
  const limits = {
    timeout: options.timeoutMs ?? 5000,
    maxEditLength: options.maxEditLength ?? 20000,
    ignoreCase: options.ignoreCase ?? false,
  };
  const raw = options.wordLevel
    ? Diff.diffWords(left.text, right.text, limits)
    : options.charLevel === false
      ? Diff.diffLines(left.text, right.text, limits)
      : Diff.diffChars(left.text, right.text, limits);
  if (!raw) throw new ComparisonIncompleteError();
  let l = 0,
    r = 0;
  const changes: DiffChange[] = [];
  for (const part of raw) {
    const n = part.value.length;
    const change: DiffChange = {
      type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
      text: '',
    };
    if (!part.added) {
      change.leftStartOffset = left.positions[l] ?? leftText.length;
      change.leftEndOffset = left.positions[l + n] ?? leftText.length;
      change.leftText = leftText.slice(change.leftStartOffset, change.leftEndOffset);
      l += n;
    }
    if (!part.removed) {
      change.rightStartOffset = right.positions[r] ?? rightText.length;
      change.rightEndOffset = right.positions[r + n] ?? rightText.length;
      change.rightText = rightText.slice(change.rightStartOffset, change.rightEndOffset);
      r += n;
    }
    change.text = change.leftText ?? change.rightText ?? '';
    changes.push(change);
  }
  let id = 0;
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]!;
    if (change.type === 'unchanged') continue;
    change.diffId = id;
    const next = changes[i + 1];
    if (change.type === 'removed' && next?.type === 'added') {
      next.diffId = id;
      i++;
    }
    id++;
  }
  return { changes, stats: calculateStats(changes) };
}
export function calculateStats(changes: DiffChange[]): DiffStats {
  const groups = new Map<number, Set<string>>();
  let unchangedChars = 0,
    addedChars = 0,
    removedChars = 0;
  for (const c of changes) {
    if (c.type === 'unchanged') {
      unchangedChars += (c.leftText ?? c.text).length;
      continue;
    }
    const id = c.diffId ?? groups.size;
    const types = groups.get(id) ?? new Set<string>();
    types.add(c.type);
    if (c.operation === 'modified') types.add('modified');
    groups.set(id, types);
    if (c.type === 'added') addedChars += c.text.length;
    if (c.type === 'removed') removedChars += c.text.length;
  }
  let additions = 0,
    deletions = 0,
    modifications = 0,
    moves = 0;
  for (const types of groups.values()) {
    if (types.has('moved')) moves++;
    else if (types.has('modified') || (types.has('added') && types.has('removed'))) modifications++;
    else if (types.has('added')) additions++;
    else deletions++;
  }
  return {
    totalChanges: groups.size,
    additions,
    deletions,
    modifications,
    moves,
    unchangedChars,
    addedChars,
    removedChars,
  };
}
export function mergeAdjacentChanges(changes: DiffChange[]): DiffChange[] {
  return changes;
}
