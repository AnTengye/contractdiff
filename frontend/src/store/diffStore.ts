// Diff store - manages diff results and statistics
import { createStore } from './Store';
import type { ParagraphDiff, DiffStats } from '@/types';
import type { ComparisonResult } from '@/services/diff/engine';

export interface DiffState {
  paragraphDiffs: ParagraphDiff[] | null;
  comparisonResult: ComparisonResult | null;
  stats: DiffStats;
  isComparing: boolean;
  currentDiffIndex: number;
  totalDiffs: number;
}

const initialState: DiffState = {
  paragraphDiffs: null,
  comparisonResult: null,
  stats: { added: 0, removed: 0, modified: 0, total: 0 },
  isComparing: false,
  currentDiffIndex: -1,
  totalDiffs: 0,
};

export const diffStore = createStore(initialState);

// Selectors
export const selectParagraphDiffs = (state: DiffState) => state.paragraphDiffs;
export const selectStats = (state: DiffState) => state.stats;
export const selectIsComparing = (state: DiffState) => state.isComparing;

// Actions
export const diffActions = {
  setDiffs(diffs: ParagraphDiff[]) {
    // Calculate stats - count paragraphs by change type
    let added = 0;
    let removed = 0;
    let modified = 0;

    for (const d of diffs) {
      if (d.hasDiff && d.diffs) {
        let hasAdd = false;
        let hasRemove = false;

        for (const [op, text] of d.diffs) {
          // Only count non-empty text changes
          if (text.trim()) {
            if (op === 1) hasAdd = true;
            if (op === -1) hasRemove = true;
          }
        }

        // Classify the paragraph change type
        if (hasAdd && hasRemove) {
          modified++;
        } else if (hasAdd) {
          added++;
        } else if (hasRemove) {
          removed++;
        }
      }
    }

    diffStore.setState({
      paragraphDiffs: diffs,
      stats: { added, removed, modified, total: added + removed + modified },
      isComparing: false,
    });
  },

  updateVisualStats(mapped: number, unmapped: number) {
    const currentStats = diffStore.getState().stats;
    diffStore.setState({
      stats: {
        ...currentStats,
        visualStats: { mapped, unmapped },
      },
    });
  },

  setComparing(isComparing: boolean) {
    diffStore.setState({ isComparing });
  },

  setComparisonResult(result: ComparisonResult) {
    const stats = result.textDiff.stats;
    const totalDiffs = result.textDiff.diffs.filter(d => d.hasDiff).length;
    
    console.log('[DiffStore] Setting comparison result:', {
      diffsCount: result.textDiff.diffs.length,
      totalDiffs,
      stats
    });
    
    diffStore.setState({
      comparisonResult: result,
      isComparing: false,
      currentDiffIndex: totalDiffs > 0 ? 0 : -1,
      totalDiffs,
      stats: {
        added: stats.addedBlocks,
        removed: stats.deletedBlocks,
        modified: stats.modifiedBlocks,
        total: stats.addedBlocks + stats.deletedBlocks + stats.modifiedBlocks,
        visualStats: {
          mapped: result.visualDiff.stats.totalAnnotations,
          unmapped: result.visualDiff.stats.unmappedChars,
        },
      },
    });
    
    // Log final state
    const newState = diffStore.getState();
    console.log('[DiffStore] State updated:', {
      hasComparisonResult: !!newState.comparisonResult,
      diffsCount: newState.comparisonResult?.textDiff.diffs.length,
      stats: newState.stats
    });
  },

  nextDiff() {
    const state = diffStore.getState();
    if (state.currentDiffIndex < state.totalDiffs - 1) {
      diffStore.setState({ currentDiffIndex: state.currentDiffIndex + 1 });
    }
  },

  previousDiff() {
    const state = diffStore.getState();
    if (state.currentDiffIndex > 0) {
      diffStore.setState({ currentDiffIndex: state.currentDiffIndex - 1 });
    }
  },

  goToDiff(index: number) {
    const state = diffStore.getState();
    if (index >= 0 && index < state.totalDiffs) {
      diffStore.setState({ currentDiffIndex: index });
    }
  },

  reset() {
    diffStore.reset(initialState);
  },
};

