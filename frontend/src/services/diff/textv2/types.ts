// Types for the new text diff engine v2 (using jsdiff)

/**
 * Span with content and bounding box from backend JSON
 */
export interface Span {
  content: string;
  bbox?: [number, number, number, number];
}

/**
 * Line containing spans
 */
export interface Line {
  spans: Span[];
  bbox?: [number, number, number, number];
}

/**
 * Block from backend with position information
 */
export interface Block {
  type?: string;
  bbox?: [number, number, number, number];
  lines?: Line[];
  blocks?: Block[]; // Nested blocks (for lists, etc.)
  index?: number;
  page?: number; // 1-indexed page number
}

/**
 * Page info from backend
 */
export interface PageInfo {
  page_idx: number;
  page_size?: [number, number];
  para_blocks?: Block[];
}

/**
 * Contract data from backend API
 */
export interface ContractData {
  pdf_info?: PageInfo[];
  paragraphs?: Block[];
  pdf_url?: string;
}

/**
 * A text segment with its source position information
 * Used to map diff results back to original coordinates
 */
export interface TextSegment {
  text: string;
  pageIdx: number;
  blockIdx: number;
  lineIdx: number;
  spanIdx: number;
  bbox?: [number, number, number, number];
  pageSize?: [number, number];
  // Character offset in the full concatenated text
  startOffset: number;
  endOffset: number;
}

/**
 * Diff operation types (compatible with jsdiff)
 */
export type DiffType = 'added' | 'removed' | 'unchanged';

/**
 * A single diff change with position mapping
 */
export interface DiffChange {
  type: DiffType;
  text: string;
  // Position in original (left) document
  leftStartOffset?: number;
  leftEndOffset?: number;
  // Position in modified (right) document
  rightStartOffset?: number;
  rightEndOffset?: number;
}

/**
 * A rendered diff segment for display
 * Contains the text, its visual position, and diff status
 */
export interface RenderSegment {
  text: string;
  type: DiffType;
  pageIdx: number;
  bbox?: [number, number, number, number];
  pageSize?: [number, number];
}

/**
 * Complete diff result for one side (left or right)
 */
export interface SideDiffResult {
  segments: RenderSegment[];
  fullText: string;
  textSegments: TextSegment[];
}

/**
 * Complete text diff result
 */
export interface TextDiffResultV2 {
  left: SideDiffResult;
  right: SideDiffResult;
  changes: DiffChange[];
  stats: DiffStats;
}

/**
 * Diff statistics
 */
export interface DiffStats {
  totalChanges: number;
  additions: number;
  deletions: number;
  modifications: number;
  unchangedChars: number;
  addedChars: number;
  removedChars: number;
}
