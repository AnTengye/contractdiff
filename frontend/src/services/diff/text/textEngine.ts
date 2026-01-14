// Text diff engine - orchestrates the text comparison process

import type { TextBlock, TextDiffResult, CharacterDiff } from './types';
import { alignBlocks, calculateAlignmentStats, type AlignmentOptions } from './blockAlignment';
import { compareBlocks, getOCRNormalizationOptions } from './characterDiff';
import { postProcessDiffs } from './postProcess';
import type { NormalizationOptions } from '@/utils/textNormalization';

/**
 * Options for text diff computation
 */
export interface TextDiffOptions {
  /** Enable OCR normalization to ignore insignificant differences */
  enableOCRNormalization?: boolean;
  /** Custom normalization options (overrides default OCR options) */
  normalizationOptions?: NormalizationOptions;
  /** Alignment options for block matching */
  alignmentOptions?: AlignmentOptions;
}

/**
 * Main text diff engine
 * Compares two sets of text blocks and produces detailed diff results
 */
export function computeTextDiff(
  leftBlocks: TextBlock[],
  rightBlocks: TextBlock[],
  options: TextDiffOptions = {}
): TextDiffResult {
  console.log(`[TextEngine] Comparing ${leftBlocks.length} left blocks vs ${rightBlocks.length} right blocks`);

  // Determine normalization options
  const normalizationOptions = options.enableOCRNormalization
    ? (options.normalizationOptions || getOCRNormalizationOptions())
    : undefined;

  if (normalizationOptions) {
    console.log('[TextEngine] OCR normalization enabled');
  }

  // Step 1: Align blocks between left and right with optional alignment options
  const alignments = alignBlocks(leftBlocks, rightBlocks, options.alignmentOptions);

  console.log(`[TextEngine] Created ${alignments.length} alignments`);

  // Step 2: Compute character-level diffs for each alignment
  const diffs: CharacterDiff[] = [];

  for (const alignment of alignments) {
    const leftBlock = alignment.leftIndex !== null
      ? leftBlocks[alignment.leftIndex]!
      : createEmptyBlock();

    const rightBlock = alignment.rightIndex !== null
      ? rightBlocks[alignment.rightIndex]!
      : createEmptyBlock();

    const diff = compareBlocks(leftBlock, rightBlock, normalizationOptions);
    diffs.push(diff);
  }

  // CRITICAL FIX: Sort diffs by page and index to ensure correct display order
  // This is a backup in case blocks or alignments are not properly sorted
  diffs.sort((a, b) => {
    const getBlockInfo = (diff: CharacterDiff) => {
      // Use the block that has content
      const block = diff.leftBlock.text ? diff.leftBlock : diff.rightBlock;
      return { pageIdx: block.pageIdx, index: block.index };
    };

    const aInfo = getBlockInfo(a);
    const bInfo = getBlockInfo(b);

    if (aInfo.pageIdx !== bInfo.pageIdx) {
      return aInfo.pageIdx - bInfo.pageIdx;
    }
    return aInfo.index - bInfo.index;
  });

  console.log('[TextEngine] Sorted diffs by page and index order');

  // Step 3: Calculate statistics
  const stats = calculateAlignmentStats(alignments, leftBlocks.length, rightBlocks.length);

  const diffsWithChanges = diffs.filter(d => d.hasDiff).length;
  console.log(`[TextEngine] Stats:`, stats);
  console.log(`[TextEngine] Diffs with changes: ${diffsWithChanges}`);

  if (normalizationOptions) {
    console.log(`[TextEngine] Normalization reduced diffs from potential noise`);
  }

  // Step 4: Post-process to fix paragraph boundary misalignment
  postProcessDiffs(diffs, { debug: true });

  // Recalculate stats after post-processing
  const finalDiffsWithChanges = diffs.filter(d => d.hasDiff).length;
  const reconciledCount = diffs.filter(d => d.reconciled).length;

  console.log(`[TextEngine] After post-processing: ${finalDiffsWithChanges} diffs with changes`);
  console.log(`[TextEngine] Reconciled ${reconciledCount} misaligned paragraph boundaries`);

  return {
    alignments,
    diffs,
    stats,
  };
}

/**
 * Create an empty block for unmatched items
 */
function createEmptyBlock(): TextBlock {
  return {
    index: -1,
    text: '',
    pageIdx: -1,
  };
}

/**
 * Export text diff results for debugging
 */
export function exportTextDiffDebug(result: TextDiffResult): string {
  const lines: string[] = [];

  lines.push('=== Text Diff Results ===');
  lines.push(`Total Alignments: ${result.alignments.length}`);
  lines.push(`Stats: ${JSON.stringify(result.stats, null, 2)}`);
  lines.push('');

  for (let i = 0; i < result.diffs.length; i++) {
    const diff = result.diffs[i]!;
    const align = result.alignments[i]!;

    lines.push(`--- Diff #${i} ---`);
    lines.push(`Alignment: L${align.leftIndex} <-> R${align.rightIndex} (${align.matchType}, sim=${align.similarity.toFixed(2)})`);
    lines.push(`Has Diff: ${diff.hasDiff}`);
    lines.push(`Left: "${diff.leftBlock.text.substring(0, 100)}..."`);
    lines.push(`Right: "${diff.rightBlock.text.substring(0, 100)}..."`);

    if (diff.hasDiff) {
      lines.push('Changes:');
      for (const [op, text] of diff.diffs) {
        const opName = op === -1 ? 'DELETE' : op === 1 ? 'INSERT' : 'EQUAL';
        const preview = text.substring(0, 50).replace(/\n/g, '\\n');
        lines.push(`  ${opName}: "${preview}${text.length > 50 ? '...' : ''}"`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}
