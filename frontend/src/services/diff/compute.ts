// Diff computation functions
import type { Paragraph, ParagraphDiff, DiffTuple } from '@/types';
import { normalizeText } from '@/services/parser';
import { smartMatchParagraphs } from './matching';
import { diff_match_patch } from 'diff-match-patch';

/**
 * Compute diff between two texts
 */
export function computeDiff(text1: string, text2: string): DiffTuple[] {
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(text1, text2);
  dmp.diff_cleanupSemantic(diffs);
  return diffs as DiffTuple[];
}

/**
 * Compute paragraph-level diffs using smart matching
 */
export function computeParagraphDiffs(
  paragraphs1: Paragraph[],
  paragraphs2: Paragraph[]
): ParagraphDiff[] {
  const matchedPairs = smartMatchParagraphs(paragraphs1, paragraphs2);
  const results: ParagraphDiff[] = [];

  for (const pair of matchedPairs) {
    // Check if normalized texts are the same
    const norm1 = normalizeText(pair.left.text);
    const norm2 = normalizeText(pair.right.text);

    if (norm1 === norm2) {
      // No difference after normalization
      results.push({
        left: pair.left,
        right: pair.right,
        diffs: [[0, pair.left.text || pair.right.text]],
        hasDiff: false,
      });
    } else {
      const diffs = computeDiff(pair.left.text, pair.right.text);

      // Filter out whitespace-only differences
      const hasRealDiff = diffs.some(d => {
        if (d[0] === 0) return false;
        const diffText = normalizeText(d[1]);
        return diffText.length > 0;
      });

      results.push({
        left: pair.left,
        right: pair.right,
        diffs: diffs,
        hasDiff: hasRealDiff,
      });
    }
  }

  return results;
}

/**
 * Extract diff texts of a specific operation type
 */
export function extractDiffTexts(diffs: DiffTuple[], opType: -1 | 1): string[] {
  const texts: string[] = [];
  for (const [op, text] of diffs) {
    if (op === opType && text.trim()) {
      texts.push(text);
    }
  }
  return texts;
}
