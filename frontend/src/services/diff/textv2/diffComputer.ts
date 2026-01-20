// Diff computer - uses jsdiff library to compute text differences
// Compares two full texts and produces detailed change information

import * as Diff from 'diff';
import type { DiffChange, DiffStats } from './types';

/**
 * Options for diff computation
 */
export interface DiffComputeOptions {
  /** Use character-level diff (default: true for Chinese text) */
  charLevel?: boolean;
  /** Use word-level diff (better for English) */
  wordLevel?: boolean;
  /** Ignore whitespace differences */
  ignoreWhitespace?: boolean;
  /** Ignore punctuation differences */
  ignorePunctuation?: boolean;
  /** Ignore case differences */
  ignoreCase?: boolean;
}

/**
 * Chinese and English punctuation marks to ignore
 * Note: Using a Set instead of regex with /g flag to avoid lastIndex issues
 */
const PUNCTUATION_CHARS = new Set<string>([
  // Chinese punctuation
  '\u3001', '\u3002', '\uff0c', '\uff1b', '\uff1a',  // 、。，；：
  '\u201c', '\u201d',  // Chinese double quotes ""
  '\u2018', '\u2019',  // Chinese single quotes ''
  '\u3010', '\u3011', '\u300c', '\u300d', '\u300e', '\u300f',  // 【】「」『』
  '\uff08', '\uff09', '\u300a', '\u300b', '\u3008', '\u3009',  // （）《》〈〉
  '\uff1f', '\uff01', '\u2026', '\u2014', '\u00b7',  // ？！…—·
  // English punctuation and whitespace
  ' ', '\t', '\n', '\r',
  ',', '.', '-', ';', ':',
  "'", '"',
  '(', ')', '[', ']', '{', '}',
  '<', '>',
  '?', '!', '@', '#', '$', '%', '^', '&', '*',
  '_', '+', '=', '|', '\\', '/', '`', '~',
]);

/**
 * Check if a character is punctuation or whitespace
 */
function isPunctuationOrWhitespace(char: string): boolean {
  return PUNCTUATION_CHARS.has(char) || /\s/.test(char);
}

/**
 * Normalize text by removing punctuation and whitespace
 */
function normalizeForComparison(
  text: string,
  options: { ignorePunctuation?: boolean; ignoreWhitespace?: boolean }
): string {
  let result = '';

  for (const char of text) {
    if (options.ignorePunctuation && isPunctuationOrWhitespace(char)) {
      continue;
    }
    if (options.ignoreWhitespace && /\s/.test(char)) {
      continue;
    }
    result += char;
  }

  return result;
}

/**
 * Compute diff between two texts using jsdiff
 * Returns a list of changes with position information
 */
export function computeDiff(
  leftText: string,
  rightText: string,
  options: DiffComputeOptions = {}
): { changes: DiffChange[]; stats: DiffStats } {
  const {
    charLevel = true,
    wordLevel = false,
    ignoreWhitespace = true,
    ignorePunctuation = true,
  } = options;

  console.log(`[DiffComputer] Computing diff, left: ${leftText.length} chars, right: ${rightText.length} chars`);
  console.log(`[DiffComputer] Options: ignoreWhitespace=${ignoreWhitespace}, ignorePunctuation=${ignorePunctuation}`);

  // Normalize texts for comparison
  const processedLeft = normalizeForComparison(leftText, { ignorePunctuation, ignoreWhitespace });
  const processedRight = normalizeForComparison(rightText, { ignorePunctuation, ignoreWhitespace });

  // Choose diff algorithm based on options
  let rawChanges: Diff.Change[];

  if (wordLevel) {
    rawChanges = Diff.diffWords(processedLeft, processedRight);
  } else if (charLevel) {
    rawChanges = Diff.diffChars(processedLeft, processedRight);
  } else {
    rawChanges = Diff.diffLines(processedLeft, processedRight);
  }

  console.log(`[DiffComputer] Raw diff produced ${rawChanges.length} changes`);

  // Now we need to map the normalized diff back to original text positions
  // This is done by tracking positions in both normalized and original texts
  const changes = mapNormalizedDiffToOriginal(
    rawChanges,
    leftText,
    rightText,
    { ignorePunctuation, ignoreWhitespace }
  );

  // Calculate statistics
  const stats = calculateStats(changes);

  console.log(`[DiffComputer] Final: ${changes.length} changes, stats:`, stats);

  return { changes, stats };
}

/**
 * Map normalized diff results back to original text positions
 */
function mapNormalizedDiffToOriginal(
  rawChanges: Diff.Change[],
  originalLeft: string,
  originalRight: string,
  options: { ignorePunctuation?: boolean; ignoreWhitespace?: boolean }
): DiffChange[] {
  const changes: DiffChange[] = [];
  
  // Build mapping from normalized position to original position
  const leftMapping = buildPositionMapping(originalLeft, options);
  const rightMapping = buildPositionMapping(originalRight, options);
  
  let normalizedLeftPos = 0;
  let normalizedRightPos = 0;

  for (const change of rawChanges) {
    const text = change.value;
    const len = text.length;

    if (change.added) {
      // Text was added (only in right)
      const origStart = rightMapping.get(normalizedRightPos) ?? normalizedRightPos;
      const origEnd = rightMapping.get(normalizedRightPos + len) ?? (normalizedRightPos + len);
      const originalText = originalRight.substring(origStart, origEnd);
      
      changes.push({
        type: 'added',
        text: originalText,
        rightStartOffset: origStart,
        rightEndOffset: origEnd,
      });
      normalizedRightPos += len;
    } else if (change.removed) {
      // Text was removed (only in left)
      const origStart = leftMapping.get(normalizedLeftPos) ?? normalizedLeftPos;
      const origEnd = leftMapping.get(normalizedLeftPos + len) ?? (normalizedLeftPos + len);
      const originalText = originalLeft.substring(origStart, origEnd);
      
      changes.push({
        type: 'removed',
        text: originalText,
        leftStartOffset: origStart,
        leftEndOffset: origEnd,
      });
      normalizedLeftPos += len;
    } else {
      // Unchanged text (in both)
      const leftOrigStart = leftMapping.get(normalizedLeftPos) ?? normalizedLeftPos;
      const leftOrigEnd = leftMapping.get(normalizedLeftPos + len) ?? (normalizedLeftPos + len);
      const rightOrigStart = rightMapping.get(normalizedRightPos) ?? normalizedRightPos;
      const rightOrigEnd = rightMapping.get(normalizedRightPos + len) ?? (normalizedRightPos + len);
      
      // Use original text from left side
      const originalText = originalLeft.substring(leftOrigStart, leftOrigEnd);
      
      changes.push({
        type: 'unchanged',
        text: originalText,
        leftStartOffset: leftOrigStart,
        leftEndOffset: leftOrigEnd,
        rightStartOffset: rightOrigStart,
        rightEndOffset: rightOrigEnd,
      });
      normalizedLeftPos += len;
      normalizedRightPos += len;
    }
  }

  return changes;
}

/**
 * Build a mapping from normalized text position to original text position
 * Only maps non-ignored characters to ensure correct position tracking
 */
function buildPositionMapping(
  originalText: string,
  options: { ignorePunctuation?: boolean; ignoreWhitespace?: boolean }
): Map<number, number> {
  const mapping = new Map<number, number>();
  let normalizedPos = 0;
  
  for (let origPos = 0; origPos < originalText.length; origPos++) {
    const char = originalText[origPos]!;
    const isIgnored = shouldIgnoreChar(char, options);
    
    if (!isIgnored) {
      // Only map non-ignored characters
      // This ensures normalized position points to the actual content character
      mapping.set(normalizedPos, origPos);
      normalizedPos++;
    }
  }
  
  // Map the end position
  mapping.set(normalizedPos, originalText.length);
  
  return mapping;
}

/**
 * Check if a character should be ignored based on options
 */
function shouldIgnoreChar(
  char: string,
  options: { ignorePunctuation?: boolean; ignoreWhitespace?: boolean }
): boolean {
  if (options.ignorePunctuation) {
    return isPunctuationOrWhitespace(char);
  }
  if (options.ignoreWhitespace) {
    return /\s/.test(char);
  }
  return false;
}

/**
 * Calculate diff statistics
 */
function calculateStats(changes: DiffChange[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  let unchangedChars = 0;
  let addedChars = 0;
  let removedChars = 0;

  for (const change of changes) {
    const len = change.text.length;

    switch (change.type) {
      case 'added':
        additions++;
        addedChars += len;
        break;
      case 'removed':
        deletions++;
        removedChars += len;
        break;
      case 'unchanged':
        unchangedChars += len;
        break;
    }
  }

  // Modifications are estimated based on adjacent add/remove pairs
  const modifications = Math.min(additions, deletions);

  return {
    totalChanges: additions + deletions,
    additions: additions - modifications,
    deletions: deletions - modifications,
    modifications,
    unchangedChars,
    addedChars,
    removedChars,
  };
}

/**
 * Merge small adjacent changes for cleaner output
 */
export function mergeAdjacentChanges(
  changes: DiffChange[],
  maxGap: number = 0
): DiffChange[] {
  if (changes.length <= 1) return changes;

  const merged: DiffChange[] = [];
  let current = { ...changes[0]! };

  for (let i = 1; i < changes.length; i++) {
    const next = changes[i]!;

    if (current.type === next.type) {
      const gap = getGap(current, next);
      
      if (gap <= maxGap) {
        current.text += next.text;
        
        if (next.leftEndOffset !== undefined) {
          current.leftEndOffset = next.leftEndOffset;
        }
        if (next.rightEndOffset !== undefined) {
          current.rightEndOffset = next.rightEndOffset;
        }
        continue;
      }
    }

    merged.push(current);
    current = { ...next };
  }

  merged.push(current);
  return merged;
}

/**
 * Get gap between two changes
 */
function getGap(a: DiffChange, b: DiffChange): number {
  if (a.type === 'added' || b.type === 'added') {
    const aEnd = a.rightEndOffset ?? 0;
    const bStart = b.rightStartOffset ?? 0;
    return bStart - aEnd;
  }

  const aEnd = a.leftEndOffset ?? 0;
  const bStart = b.leftStartOffset ?? 0;
  return bStart - aEnd;
}

/**
 * Filter out insignificant changes
 */
export function filterInsignificantChanges(
  changes: DiffChange[],
  options: {
    ignoreWhitespaceOnly?: boolean;
    minLength?: number;
  } = {}
): DiffChange[] {
  const { ignoreWhitespaceOnly = true, minLength = 0 } = options;

  return changes.filter(change => {
    if (change.type === 'unchanged') return true;
    if (change.text.length < minLength) return false;
    if (ignoreWhitespaceOnly && change.text.trim().length === 0) return false;
    return true;
  });
}
