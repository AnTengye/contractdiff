// Text diff types for precise comparison

export type DiffOperation = -1 | 0 | 1; // delete, equal, insert
export type DiffTuple = [DiffOperation, string];

/**
 * A text block from the source document
 */
export interface TextBlock {
  index: number;
  text: string;
  pageIdx: number;
  type?: string;
  // Raw source data for reference
  raw?: unknown;
}

/**
 * Character-level diff between two text blocks
 */
export interface CharacterDiff {
  leftBlock: TextBlock;
  rightBlock: TextBlock;
  diffs: DiffTuple[];
  hasDiff: boolean;
  similarity: number;
}

/**
 * Alignment between left and right blocks
 */
export interface BlockAlignment {
  leftIndex: number | null;   // null means no match (added on right)
  rightIndex: number | null;   // null means no match (deleted on left)
  matchType: 'exact' | 'similar' | 'unmatched';
  similarity: number;
}

/**
 * Complete text diff result
 */
export interface TextDiffResult {
  alignments: BlockAlignment[];
  diffs: CharacterDiff[];
  stats: {
    totalBlocks: number;
    matchedBlocks: number;
    addedBlocks: number;
    deletedBlocks: number;
    modifiedBlocks: number;
  };
}
