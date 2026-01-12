// Updated comparison feature to use new engine

import { contractStore, diffStore, diffActions, pdfActions, uiActions } from '@/store';
import { runComparison as runComparisonEngine, exportComparisonDebug } from '@/services/diff/engine';
import type { ComparisonResult } from '@/services/diff/engine';

/**
 * Run comparison using the new precision engine
 */
export function runComparisonV2(): ComparisonResult | null {
  const state = contractStore.getState();

  if (!state.left.data || !state.right.data) {
    console.warn('Cannot compare: missing data');
    return null;
  }

  // Set comparing state
  diffActions.setComparing(true);

  try {
    console.log('[ComparisonV2] Starting precision comparison...');

    // Run the new comparison engine with OCR normalization and position-aware scoring
    const result = runComparisonEngine(
      state.left.data,
      state.right.data,
      {
        mergeAnnotations: true,
        debug: true,
        enableOCRNormalization: true,  // Enable OCR normalization to reduce false positives
        usePositionScoring: true,       // Enable position-aware scoring for better alignment
      }
    );

    // Update stores with results
    diffActions.setComparisonResult(result);
    pdfActions.setVisualAnnotations(
      result.visualDiff.leftAnnotations,
      result.visualDiff.rightAnnotations
    );

    // Show results sections
    uiActions.showResults();

    console.log('[ComparisonV2] Comparison complete');
    console.log(`[ComparisonV2] Text stats:`, result.textDiff.stats);
    console.log(`[ComparisonV2] Visual stats:`, result.visualDiff.stats);

    // Export debug info
    if (typeof window !== 'undefined') {
      (window as any).lastComparisonDebug = exportComparisonDebug(result);
      console.log('[ComparisonV2] Debug info available in window.lastComparisonDebug');
    }

    return result;
  } catch (error) {
    console.error('[ComparisonV2] Comparison failed:', error);
    diffActions.setComparing(false);
    return null;
  }
}

/**
 * Get current comparison results
 */
export function getComparisonResult(): ComparisonResult | null {
  return diffStore.getState().comparisonResult;
}

/**
 * Reset comparison state
 */
export function resetComparisonV2(): void {
  diffActions.reset();
  pdfActions.reset();
  uiActions.hideResults();
}

// Re-export legacy functions for compatibility
export { runComparison, getDiffResults, resetComparison } from './runComparison';
