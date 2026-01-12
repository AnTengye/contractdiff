// Character-level diff computation using diff-match-patch

import { diff_match_patch } from 'diff-match-patch';
import type { DiffTuple, TextBlock, CharacterDiff } from './types';
import { normalizeText, type NormalizationOptions, DEFAULT_NORMALIZATION_OPTIONS } from '@/utils/textNormalization';

/**
 * Compute character-level diff between two text strings
 * Optionally normalizes text to ignore OCR artifacts
 */
export function computeCharacterDiff(
  text1: string, 
  text2: string,
  options?: NormalizationOptions
): DiffTuple[] {
  const dmp = new diff_match_patch();
  
  // Normalize texts if options provided
  const normalizedText1 = options ? normalizeText(text1, options) : text1;
  const normalizedText2 = options ? normalizeText(text2, options) : text2;
  
  const diffs = dmp.diff_main(normalizedText1, normalizedText2);
  dmp.diff_cleanupSemantic(diffs);
  return diffs as DiffTuple[];
}

/**
 * Calculate similarity between two strings (0.0 to 1.0)
 * Optionally normalizes text before comparison
 */
export function calculateTextSimilarity(
  text1: string, 
  text2: string,
  options?: NormalizationOptions
): number {
  // Normalize texts if options provided
  const normalizedText1 = options ? normalizeText(text1, options) : text1;
  const normalizedText2 = options ? normalizeText(text2, options) : text2;
  
  if (normalizedText1 === normalizedText2) return 1.0;
  if (!normalizedText1 || !normalizedText2) return 0.0;
  
  const diffs = computeCharacterDiff(text1, text2, options);
  
  let totalLength = 0;
  let equalLength = 0;
  
  for (const [op, text] of diffs) {
    const len = text.length;
    totalLength += len;
    if (op === 0) {
      equalLength += len;
    }
  }
  
  return totalLength > 0 ? equalLength / totalLength : 0.0;
}

/**
 * Check if diff contains real changes (not just whitespace)
 */
export function hasRealDiff(diffs: DiffTuple[]): boolean {
  for (const [op, text] of diffs) {
    if (op !== 0 && text.trim().length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Compare two blocks and compute character-level diff
 * Optionally normalizes text to ignore OCR artifacts
 */
export function compareBlocks(
  leftBlock: TextBlock,
  rightBlock: TextBlock,
  options?: NormalizationOptions
): CharacterDiff {
  const diffs = computeCharacterDiff(leftBlock.text, rightBlock.text, options);
  const similarity = calculateTextSimilarity(leftBlock.text, rightBlock.text, options);
  
  return {
    leftBlock,
    rightBlock,
    diffs,
    hasDiff: hasRealDiff(diffs),
    similarity,
  };
}

/**
 * Normalize whitespace for comparison (deprecated - use textNormalization.ts)
 * @deprecated Use normalizeText from @/utils/textNormalization instead
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Get default normalization options for OCR documents
 */
export function getOCRNormalizationOptions(): NormalizationOptions {
  return {
    ...DEFAULT_NORMALIZATION_OPTIONS,
    normalizeWhitespace: true,
    normalizePunctuation: true,
    ignoreCheckboxes: true,
    normalizeQuotes: true,
    normalizeFullwidth: true,
    normalizeDashes: true,
    removeInvisibleChars: true,
  };
}
