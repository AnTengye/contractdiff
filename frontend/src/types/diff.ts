// Diff types
import type { Paragraph } from './contract';

export type DiffOperation = -1 | 0 | 1; // delete, equal, insert
export type DiffTuple = [DiffOperation, string];

export interface ParagraphDiff {
  left: Paragraph;
  right: Paragraph;
  diffs: DiffTuple[];
  hasDiff: boolean;
}

export interface MatchedPair {
  left: Paragraph;
  right: Paragraph;
  similarity: number;
  isMatch: boolean;
  matchType?: 'number' | 'similarity';
}

export interface DiffStats {
  added: number;
  removed: number;
  total: number;
}
