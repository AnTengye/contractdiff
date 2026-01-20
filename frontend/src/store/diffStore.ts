// Diff store - manages diff results and statistics
import { createStore } from './Store';
import type { TextDiffResultV2 } from '@/services/diff/textv2';

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
  total: number;
}

export interface DiffState {
  textDiffResult: TextDiffResultV2 | null;
  stats: DiffStats;
  isComparing: boolean;
  currentDiffIndex: number;
  totalDiffs: number;
}

const initialState: DiffState = {
  textDiffResult: null,
  stats: { added: 0, removed: 0, modified: 0, total: 0 },
  isComparing: false,
  currentDiffIndex: -1,
  totalDiffs: 0,
};

export const diffStore = createStore(initialState);

// Selectors
export const selectStats = (state: DiffState) => state.stats;
export const selectIsComparing = (state: DiffState) => state.isComparing;
export const selectTextDiffResult = (state: DiffState) => state.textDiffResult;

// Actions
export const diffActions = {
  setComparing(isComparing: boolean) {
    diffStore.setState({ isComparing });
  },

  /**
   * Set text diff result (jsdiff-based engine)
   */
  setTextDiffResult(result: TextDiffResultV2) {
    const totalDiffs = result.changes.filter(c => c.type !== 'unchanged').length;
    
    console.log('[DiffStore] Setting text diff result:', {
      changesCount: result.changes.length,
      totalDiffs,
      stats: result.stats
    });
    
    diffStore.setState({
      textDiffResult: result,
      isComparing: false,
      currentDiffIndex: totalDiffs > 0 ? 0 : -1,
      totalDiffs,
      stats: {
        added: result.stats.additions,
        removed: result.stats.deletions,
        modified: result.stats.modifications,
        total: result.stats.totalChanges,
      },
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
