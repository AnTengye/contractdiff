// Re-export all stores
export { Store } from './Store';
export { contractStore, contractActions, selectCanCompare, selectIsUploading } from './contractStore';
export { diffStore, diffActions, selectParagraphDiffs, selectStats } from './diffStore';
export { pdfStore, pdfActions, selectZoomLevel } from './pdfStore';
export { uiStore, uiActions, selectSyncScrollEnabled } from './uiStore';

export type { ContractState, ContractSideState } from './contractStore';
export type { DiffState } from './diffStore';
export type { PdfState } from './pdfStore';
export type { UiState, SyncScrollMode } from './uiStore';
