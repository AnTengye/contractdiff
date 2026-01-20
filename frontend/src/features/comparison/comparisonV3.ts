// Comparison feature - uses jsdiff-based text diff engine
// Provides whole-document comparison with coordinate mapping

import { contractStore, diffStore, diffActions, pdfActions, uiActions } from '@/store';
import { computeTextDiffV2, exportDiffDebug, type TextDiffResultV2 } from '@/services/diff/textv2';
import type { ContractData } from '@/types';

/**
 * Run comparison using jsdiff-based engine
 * This approach:
 * 1. Extracts all text content from both documents
 * 2. Compares them as whole documents using jsdiff
 * 3. Maps differences back to original coordinates for display
 * 
 * By default, ignores whitespace and punctuation differences
 */
export function runComparisonV3(): TextDiffResultV2 | null {
  const state = contractStore.getState();

  if (!state.left.data || !state.right.data) {
    console.warn('[Comparison] Cannot compare: missing data');
    return null;
  }

  // Set comparing state
  diffActions.setComparing(true);

  try {
    console.log('[Comparison] Starting jsdiff-based comparison...');

    // Run the text diff engine with default options
    // ignoreWhitespace and ignorePunctuation are true by default
    const result = computeTextDiffV2(
      state.left.data as ContractData,
      state.right.data as ContractData,
      {
        charLevel: true,           // Character-level diff for Chinese text
        ignoreWhitespace: true,    // Ignore whitespace differences
        ignorePunctuation: true,   // Ignore punctuation differences
        mergeSegments: true,       // Merge adjacent same-type segments
        debug: true,
      }
    );

    // Update store with results
    diffActions.setTextDiffResult(result);

    // Show results sections
    uiActions.showResults();

    console.log('[Comparison] Comparison complete');
    console.log('[Comparison] Stats:', result.stats);

    // Export debug info
    if (typeof window !== 'undefined') {
      (window as any).lastDiffDebug = exportDiffDebug(result);
      console.log('[Comparison] Debug info available in window.lastDiffDebug');
    }

    return result;
  } catch (error) {
    console.error('[Comparison] Comparison failed:', error);
    diffActions.setComparing(false);
    return null;
  }
}

/**
 * Get current comparison results
 */
export function getComparisonResultV3(): TextDiffResultV2 | null {
  return diffStore.getState().textDiffResult;
}

/**
 * Reset comparison state
 */
export function resetComparisonV3(): void {
  diffActions.reset();
  pdfActions.reset();
  uiActions.hideResults();
}
