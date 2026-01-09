// Diff store - manages diff results and statistics
import { Store } from './Store';
import type { ParagraphDiff, DiffStats } from '@/types';

interface DiffState {
  paragraphDiffs: ParagraphDiff[] | null;
  stats: DiffStats;
  isComparing: boolean;
}

const initialState: DiffState = {
  paragraphDiffs: null,
  stats: { added: 0, removed: 0, modified: 0, total: 0 },
  isComparing: false,
};

export const diffStore = new Store(initialState);

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

  reset() {
    diffStore.reset(initialState);
  },
};

export type { DiffState };
