// Smart paragraph matching
import type { Paragraph, MatchedPair } from '@/types';
import { extractSectionNumber, normalizeNumber } from '@/services/parser';
import { calculateSimilarity } from './similarity';
import { SIMILARITY_THRESHOLD } from '@/constants';

/**
 * Smart match paragraphs (prioritize section number matching, then similarity matching)
 */
export function smartMatchParagraphs(
  paragraphs1: Paragraph[],
  paragraphs2: Paragraph[]
): MatchedPair[] {
  const matched1 = new Set<number>();
  const matched2 = new Set<number>();
  const pairs: MatchedPair[] = [];

  // First pass: match by section number (highest priority)
  for (let i = 0; i < paragraphs1.length; i++) {
    const num1 = extractSectionNumber(paragraphs1[i]!.text);
    if (!num1) continue;

    const normNum1 = normalizeNumber(num1);

    for (let j = 0; j < paragraphs2.length; j++) {
      if (matched2.has(j)) continue;

      const num2 = extractSectionNumber(paragraphs2[j]!.text);
      if (!num2) continue;

      const normNum2 = normalizeNumber(num2);

      // Section number match
      if (normNum1 === normNum2) {
        matched1.add(i);
        matched2.add(j);
        pairs.push({
          left: paragraphs1[i]!,
          right: paragraphs2[j]!,
          similarity: calculateSimilarity(paragraphs1[i]!.text, paragraphs2[j]!.text),
          isMatch: true,
          matchType: 'number',
        });
        break;
      }
    }
  }

  // Second pass: match unmatched paragraphs by similarity
  for (let i = 0; i < paragraphs1.length; i++) {
    if (matched1.has(i)) continue;

    let bestMatch = -1;
    let bestScore = SIMILARITY_THRESHOLD;

    for (let j = 0; j < paragraphs2.length; j++) {
      if (matched2.has(j)) continue;

      const similarity = calculateSimilarity(
        paragraphs1[i]!.text,
        paragraphs2[j]!.text
      );

      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatch = j;
      }
    }

    if (bestMatch !== -1) {
      matched1.add(i);
      matched2.add(bestMatch);
      pairs.push({
        left: paragraphs1[i]!,
        right: paragraphs2[bestMatch]!,
        similarity: bestScore,
        isMatch: bestScore >= SIMILARITY_THRESHOLD,
        matchType: 'similarity',
      });
    }
  }

  // Handle unmatched left paragraphs (deletions)
  for (let i = 0; i < paragraphs1.length; i++) {
    if (!matched1.has(i)) {
      pairs.push({
        left: paragraphs1[i]!,
        right: { text: '', pageIdx: paragraphs1[i]!.pageIdx },
        similarity: 0,
        isMatch: false,
      });
    }
  }

  // Handle unmatched right paragraphs (additions)
  for (let j = 0; j < paragraphs2.length; j++) {
    if (!matched2.has(j)) {
      pairs.push({
        left: { text: '', pageIdx: paragraphs2[j]!.pageIdx },
        right: paragraphs2[j]!,
        similarity: 0,
        isMatch: false,
      });
    }
  }

  // Sort by page index
  pairs.sort((a, b) => {
    const pageA = Math.max(a.left.pageIdx || 0, a.right.pageIdx || 0);
    const pageB = Math.max(b.left.pageIdx || 0, b.right.pageIdx || 0);
    return pageA - pageB;
  });

  return pairs;
}
