// Diff store - manages diff results and statistics
import { createStore } from './Store';
import type { TextDiffResultV2 } from '@/services/diff/textv2';
import type { AIJob } from '@/services/api/aiDiff';
import type { MappedAIFinding } from '@/services/diff/aiMapping';

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
  moved: number;
  total: number;
}

export interface DiffState {
  textDiffResult: TextDiffResultV2 | null;
  stats: DiffStats;
  isComparing: boolean;
  currentDiffIndex: number;
  totalDiffs: number;
  comparisonId: string | null;
  error: string | null;
  aiStatus: 'idle' | 'running' | 'completed' | 'partial' | 'failed';
  aiJob: AIJob | null;
  aiFindings: MappedAIFinding[];
  aiError: string | null;
  aiCandidates: Record<string, number>;
  context: {
    engineVersion: string;
    buildRevision: string;
    options: Record<string, unknown>;
  } | null;
}

const initialState: DiffState = {
  textDiffResult: null,
  stats: { added: 0, removed: 0, modified: 0, moved: 0, total: 0 },
  isComparing: false,
  currentDiffIndex: -1,
  totalDiffs: 0,
  comparisonId: null,
  context: null,
  error: null,
  aiStatus: 'idle',
  aiJob: null,
  aiFindings: [],
  aiError: null,
  aiCandidates: {},
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
    const totalDiffs = result.stats.totalChanges;

    console.log('[DiffStore] Setting text diff result:', {
      changesCount: result.changes.length,
      totalDiffs,
      stats: result.stats,
    });

    diffStore.setState({
      textDiffResult: result,
      aiStatus: 'idle', aiJob: null, aiFindings: [], aiError: null, aiCandidates: {},
      comparisonId:
        globalThis.crypto?.randomUUID?.() ??
        `comparison-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      error: null,
      isComparing: false,
      currentDiffIndex: totalDiffs > 0 ? 0 : -1,
      totalDiffs,
      stats: {
        added: result.stats.additions,
        removed: result.stats.deletions,
        modified: result.stats.modifications,
        moved: result.stats.moves,
        total: result.stats.totalChanges,
      },
    });
  },

  setContext(context: DiffState['context']) {
    diffStore.setState({ context });
  },

  setAIStatus(aiStatus: DiffState['aiStatus'], aiError: string | null = null) {
    diffStore.setState({ aiStatus, aiError });
  },

  setAIJob(job: AIJob, findings: MappedAIFinding[]) {
    const state = diffStore.getState();
    const totalDiffs = (state.textDiffResult?.stats.totalChanges ?? 0) + findings.length;
    diffStore.setState({
      aiJob: job, aiFindings: findings,
      aiStatus: job.status === 'queued' || job.status === 'running' ? 'running' : job.status,
      aiError: job.error ?? null, totalDiffs,
      currentDiffIndex: state.currentDiffIndex < 0 && state.stats.total === 0 && findings.length > 0 ? 0 : state.currentDiffIndex < totalDiffs ? state.currentDiffIndex : -1,
    });
  },

  selectAICandidate(findingId: string, side: 'left' | 'right', index: number, diffIndex: number) {
    diffStore.setState(state=>({
      aiCandidates: { ...state.aiCandidates, [`${findingId}:${side}`]: index }, currentDiffIndex: diffIndex,
    }));
  },

  setError(error: string) {
    diffStore.setState({
      textDiffResult: null,
      aiStatus: 'idle', aiJob: null, aiFindings: [], aiError: null, aiCandidates: {}, currentDiffIndex: -1,
      comparisonId: null,
      error,
      isComparing: false,
      totalDiffs: 0,
      stats: { added: 0, removed: 0, modified: 0, moved: 0, total: 0 },
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
