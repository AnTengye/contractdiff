// Similarity calculation functions
import { normalizeText } from '@/services/parser';

/**
 * Calculate similarity between two strings using Jaccard similarity on n-grams
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  // Use character n-grams
  const n = 2;
  const ngrams1 = new Set<string>();
  const ngrams2 = new Set<string>();

  for (let i = 0; i <= s1.length - n; i++) {
    ngrams1.add(s1.substring(i, i + n));
  }
  for (let i = 0; i <= s2.length - n; i++) {
    ngrams2.add(s2.substring(i, i + n));
  }

  if (ngrams1.size === 0 && ngrams2.size === 0) return 1.0;

  // Jaccard similarity
  const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
  const union = new Set([...ngrams1, ...ngrams2]);

  return intersection.size / union.size;
}
