// Text Diff V2 - Module exports

export * from './types';
export * from './textExtractor';
export * from './diffComputer';
export * from './diffMapper';
export {
  computeTextDiffV2,
  getDiffIndices,
  countDiffs,
  exportDiffDebug,
  type TextDiffEngineOptions,
} from './engine';
