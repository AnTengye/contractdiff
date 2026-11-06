// Text Diff Engine V2 - Main orchestrator
// Aligns document units before using jsdiff and maps results to source coordinates.

import type { ContractData, TextDiffResultV2 } from './types';
import { extractText } from './textExtractor';
import { calculateStats, type DiffComputeOptions } from './diffComputer';
import { computeAlignedDiff } from './alignment';
import { DIFF_ENGINE_VERSION, BUILD_REVISION } from './version';
export { DIFF_ENGINE_VERSION } from './version';
import { mapChangesToSegments, mergeAdjacentRenderSegments } from './diffMapper';

/**
 * Options for the text diff engine
 */
export interface TextDiffEngineOptions {
  /** Use character-level diff (default: true, better for Chinese) */
  charLevel?: boolean;
  /** Use word-level diff (better for English) */
  wordLevel?: boolean;
  /** Ignore whitespace differences (default: true) */
  ignoreWhitespace?: boolean;
  /** Ignore ordinary punctuation differences (default: false) */
  ignorePunctuation?: boolean;
  /** Merge adjacent segments with same type */
  mergeSegments?: boolean;
  /** Enable debug logging */
  debug?: boolean;
  ignoreHeaders?: boolean;
  timeoutMs?: number;
  maxEditLength?: number;
}

/**
 * Main entry point: Compare two contract documents
 * Returns complete diff result with render-ready segments
 */
export function computeTextDiffV2(
  leftData: ContractData,
  rightData: ContractData,
  options: TextDiffEngineOptions = {}
): TextDiffResultV2 {
  const {
    charLevel = true,
    wordLevel = false,
    ignoreWhitespace = true,
    ignorePunctuation = false,
    mergeSegments = true,
    debug = false,
  } = options;

  if (debug) console.log('[TextDiffV2] Starting comparison...');
  if (debug) console.log('[TextDiffV2] Options:', { ignoreWhitespace, ignorePunctuation });

  // Step 1: Extract text from both documents
  const started = performance.now();
  const leftExtracted = extractText(leftData, options);
  const rightExtracted = extractText(rightData, options);
  if (!leftExtracted.units.length || !rightExtracted.units.length)
    throw new Error('文档没有可比较内容，请检查解析结果或提交反馈。');
  if (leftExtracted.fullText.length + rightExtracted.fullText.length > 2000000)
    throw new Error('文档超出本次比对范围，请拆分后重试。');

  if (debug) {
    console.log('[TextDiffV2] Left text preview:', leftExtracted.fullText.substring(0, 200));
    console.log('[TextDiffV2] Right text preview:', rightExtracted.fullText.substring(0, 200));
  }

  // Step 2: Align paragraphs and cells, then compare text within matched units.
  const diffOptions: DiffComputeOptions = {
    charLevel,
    wordLevel,
    ignoreWhitespace,
    ignorePunctuation,
  };

  diffOptions.timeoutMs = options.timeoutMs;
  diffOptions.maxEditLength = options.maxEditLength;
  const changes = computeAlignedDiff(
    leftExtracted.units,
    rightExtracted.units,
    leftExtracted.fullText,
    rightExtracted.fullText,
    diffOptions
  );
  const stats = calculateStats(changes);

  if (debug) {
    console.log('[TextDiffV2] Diff changes count:', changes.length);
    console.log('[TextDiffV2] Stats:', stats);
  }

  // Step 3: Map changes to render segments for each side
  let leftSegments = mapChangesToSegments(changes, leftExtracted.segments, 'left');
  let rightSegments = mapChangesToSegments(changes, rightExtracted.segments, 'right');

  // Step 4: Optionally merge adjacent segments
  if (mergeSegments) {
    leftSegments = mergeAdjacentRenderSegments(leftSegments);
    rightSegments = mergeAdjacentRenderSegments(rightSegments);
  }

  if (debug)
    console.log(
      `[TextDiffV2] Left segments: ${leftSegments.length}, Right segments: ${rightSegments.length}`
    );

  const coordinateWarnings = [leftData, rightData].flatMap((data) => {
    const values = data.metadata?.coordinate_warnings;
    return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
  });
  const warnings = [
    ...coordinateWarnings,
    ...([...leftSegments, ...rightSegments].some((s) => s.type !== 'unchanged' && !s.bbox)
      ? ['部分差异缺少坐标，无法在 PDF 上定位。']
      : []),
    ...([...leftSegments, ...rightSegments].some(
      (s) => s.type !== 'unchanged' && s.bbox && s.precision === 'block'
    )
      ? ['部分位置仅有区域坐标，高亮显示整个区域。']
      : []),
  ];

  return {
    left: {
      segments: leftSegments,
      fullText: leftExtracted.fullText,
      textSegments: leftExtracted.segments,
    },
    right: {
      segments: rightSegments,
      fullText: rightExtracted.fullText,
      textSegments: rightExtracted.segments,
    },
    changes,
    stats,
    metadata: {
      engineVersion: DIFF_ENGINE_VERSION,
      buildRevision: BUILD_REVISION,
      options: {
        ignoreWhitespace,
        ignorePunctuation,
        ignoreHeaders: options.ignoreHeaders ?? false,
        charLevel,
        wordLevel,
        mergeSegments,
        timeoutMs: options.timeoutMs ?? 10000,
        maxEditLength: options.maxEditLength ?? 20000,
      },
      durationMs: performance.now() - started,
      warnings: [...new Set(warnings)],
    },
  };
}

/**
 * Get diff indices for navigation (segments with changes)
 */
export function getDiffIndices(result: TextDiffResultV2, side: 'left' | 'right'): number[] {
  const segments = side === 'left' ? result.left.segments : result.right.segments;
  const indices: number[] = [];

  for (let i = 0; i < segments.length; i++) {
    if (segments[i]!.type !== 'unchanged') {
      indices.push(i);
    }
  }

  return indices;
}

/**
 * Count total number of differences
 */
export function countDiffs(result: TextDiffResultV2): number {
  return result.stats.totalChanges;
}

/**
 * Export result for debugging
 */
export function exportDiffDebug(result: TextDiffResultV2): string {
  const lines: string[] = [];

  lines.push('=== Text Diff V2 Results ===');
  lines.push(`Left text length: ${result.left.fullText.length}`);
  lines.push(`Right text length: ${result.right.fullText.length}`);
  lines.push(`Total changes: ${result.changes.length}`);
  lines.push('');
  lines.push('--- Stats ---');
  lines.push(JSON.stringify(result.stats, null, 2));
  lines.push('');
  lines.push('--- Changes Preview (first 20) ---');

  for (let i = 0; i < Math.min(20, result.changes.length); i++) {
    const change = result.changes[i]!;
    const preview = change.text.substring(0, 50).replace(/\n/g, '\\n');
    lines.push(`${change.type.toUpperCase()}: "${preview}${change.text.length > 50 ? '...' : ''}"`);
  }

  return lines.join('\n');
}
