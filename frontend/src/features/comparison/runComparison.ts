// Comparison feature - main comparison logic
import { contractStore, diffStore, diffActions, uiActions } from '@/store';
import { parseContractJSON, computeParagraphDiffs } from '@/services';
import type { ParagraphDiff } from '@/types';

/**
 * Run comparison between left and right documents
 */
export function runComparison(): ParagraphDiff[] | null {
  const state = contractStore.getState();

  if (!state.left.data || !state.right.data) {
    console.warn('Cannot compare: missing data');
    return null;
  }

  // Set comparing state
  diffActions.setComparing(true);

  try {
    // Parse both documents
    const leftParagraphs = parseContractJSON(state.left.data);
    const rightParagraphs = parseContractJSON(state.right.data);

    console.log(`Comparing: ${leftParagraphs.length} left paragraphs vs ${rightParagraphs.length} right paragraphs`);

    // Compute diffs
    const paragraphDiffs = computeParagraphDiffs(leftParagraphs, rightParagraphs);

    // Update store
    diffActions.setDiffs(paragraphDiffs);

    // Show results sections
    uiActions.showResults();

    return paragraphDiffs;
  } catch (error) {
    console.error('Comparison failed:', error);
    diffActions.setComparing(false);
    return null;
  }
}

/**
 * Get current diff results
 */
export function getDiffResults(): ParagraphDiff[] | null {
  return diffStore.getState().paragraphDiffs;
}

/**
 * Reset comparison state
 */
export function resetComparison(): void {
  diffActions.reset();
  uiActions.hideResults();
}
