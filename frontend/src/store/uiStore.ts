// UI store - manages UI state
import { Store } from './Store';

type SyncScrollMode = 'percentage' | 'anchor';

interface UiState {
  syncScrollEnabled: boolean;
  syncScrollMode: SyncScrollMode;
  isSyncing: boolean;
  showPdfSection: boolean;
  showDiffSection: boolean;
  showStatsSection: boolean;
}

const initialState: UiState = {
  syncScrollEnabled: true,
  syncScrollMode: 'percentage',
  isSyncing: false,
  showPdfSection: false,
  showDiffSection: false,
  showStatsSection: false,
};

export const uiStore = new Store(initialState);

// Selectors
export const selectSyncScrollEnabled = (state: UiState) => state.syncScrollEnabled;
export const selectSyncScrollMode = (state: UiState) => state.syncScrollMode;

// Actions
export const uiActions = {
  toggleSyncScroll() {
    uiStore.setState(state => ({ syncScrollEnabled: !state.syncScrollEnabled }));
  },

  setSyncScrollMode(mode: SyncScrollMode) {
    uiStore.setState({ syncScrollMode: mode });
  },

  setIsSyncing(isSyncing: boolean) {
    uiStore.setState({ isSyncing });
  },

  showResults() {
    uiStore.setState({
      showPdfSection: true,
      showDiffSection: true,
      showStatsSection: true,
    });
  },

  hideResults() {
    uiStore.setState({
      showPdfSection: false,
      showDiffSection: false,
      showStatsSection: false,
    });
  },

  reset() {
    uiStore.reset(initialState);
  },
};

export type { UiState, SyncScrollMode };
