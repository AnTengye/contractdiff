// Text Diff Engine V2 - Main orchestrator
// Uses jsdiff for whole-document comparison with coordinate mapping

import type {
  ContractData,
  TextDiffResultV2,
} from './types';
import { extractText } from './textExtractor';
import { computeDiff, type DiffComputeOptions } from './diffComputer';
import {
  mapChangesToSegments,
  mergeAdjacentRenderSegments,
} from './diffMapper';

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
  /** Ignore punctuation differences (default: true) */
  ignorePunctuation?: boolean;
  /** Merge adjacent segments with same type */
  mergeSegments?: boolean;
  /** Enable debug logging */
  debug?: boolean;
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
    ignorePunctuation = true,
    mergeSegments = true,
    debug = false,
  } = options;

  console.log('[TextDiffV2] Starting comparison...');
  console.log('[TextDiffV2] Options:', { ignoreWhitespace, ignorePunctuation });

  // Step 1: Extract text from both documents
  const leftExtracted = extractText(leftData);
  const rightExtracted = extractText(rightData);

  if (debug) {
    console.log('[TextDiffV2] Left text preview:', leftExtracted.fullText.substring(0, 200));
    console.log('[TextDiffV2] Right text preview:', rightExtracted.fullText.substring(0, 200));
  }

  // Step 2: Compute diff between the two full texts
  const diffOptions: DiffComputeOptions = {
    charLevel,
    wordLevel,
    ignoreWhitespace,
    ignorePunctuation,
  };

  const { changes, stats } = computeDiff(
    leftExtracted.fullText,
    rightExtracted.fullText,
    diffOptions
  );

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

  console.log(`[TextDiffV2] Left segments: ${leftSegments.length}, Right segments: ${rightSegments.length}`);

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
  return result.changes.filter(c => c.type !== 'unchanged').length;
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
