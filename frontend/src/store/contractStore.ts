// Contract store - manages upload state for both sides
import { Store } from './Store';
import type { ContractData, FileType, CancelToken } from '@/types';

interface ContractSideState {
  data: ContractData | null;
  contractId: string | null;
  pdfUrl: string | null;
  fileType: FileType | null;
  fileName: string | null;
  isUploading: boolean;
  uploadProgress: number;
  progressText: string;
  error: string | null;
  isCached: boolean;
}

interface ContractState {
  left: ContractSideState;
  right: ContractSideState;
  cancelTokens: {
    left: CancelToken | null;
    right: CancelToken | null;
  };
  parsersLoaded: boolean;
}

const createInitialSideState = (): ContractSideState => ({
  data: null,
  contractId: null,
  pdfUrl: null,
  fileType: null,
  fileName: null,
  isUploading: false,
  uploadProgress: 0,
  progressText: '',
  error: null,
  isCached: false,
});

const initialState: ContractState = {
  left: createInitialSideState(),
  right: createInitialSideState(),
  cancelTokens: { left: null, right: null },
  parsersLoaded: false,
};

export const contractStore = new Store(initialState);

// Selectors
export const selectLeftData = (state: ContractState) => state.left.data;
export const selectRightData = (state: ContractState) => state.right.data;
export const selectCanCompare = (state: ContractState) =>
  state.left.data !== null && state.right.data !== null;
export const selectIsUploading = (state: ContractState) =>
  state.left.isUploading || state.right.isUploading;

// Actions
export const contractActions = {
setData(
    side: 'left' | 'right',
    data: ContractData,
    contractId: string,
    pdfUrl: string,
    fileType: FileType,
    fileName: string,
    isCached = false
  ) {
    contractStore.setState(state => ({
      [side]: {
        ...state[side],
        data,
        contractId,
        pdfUrl,
        fileType,
        fileName,
        isUploading: false,
        error: null,
        isCached,
      },
    }));
  },

  setUploadProgress(side: 'left' | 'right', progress: number, text: string) {
    contractStore.setState(state => ({
      [side]: {
        ...state[side],
        uploadProgress: progress,
        progressText: text,
        isUploading: true,
      },
    }));
  },

  setUploadError(side: 'left' | 'right', error: string) {
    contractStore.setState(state => ({
      [side]: {
        ...state[side],
        error,
        isUploading: false,
        uploadProgress: 0,
        progressText: '',
      },
    }));
  },

  setCancelToken(side: 'left' | 'right', token: CancelToken | null) {
    contractStore.setState(state => ({
      cancelTokens: {
        ...state.cancelTokens,
        [side]: token,
      },
    }));
  },

  cancelUpload(side: 'left' | 'right') {
    const token = contractStore.getState().cancelTokens[side];
    if (token) {
      token.cancelled = true;
    }
    contractStore.setState(state => ({
      [side]: {
        ...state[side],
        isUploading: false,
        uploadProgress: 0,
        progressText: '',
      },
      cancelTokens: {
        ...state.cancelTokens,
        [side]: null,
      },
    }));
  },

  setParsersLoaded(loaded: boolean) {
    contractStore.setState({ parsersLoaded: loaded });
  },

  resetSide(side: 'left' | 'right') {
    contractStore.setState({
      [side]: createInitialSideState(),
    });
  },

  reset() {
    contractStore.reset(initialState);
  },
};

export type { ContractState, ContractSideState };
