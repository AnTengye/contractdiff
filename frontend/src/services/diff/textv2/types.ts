export type Bbox = [number, number, number, number];
export type CoordinatePrecision = 'character' | 'span' | 'line' | 'cell' | 'block' | 'unknown';
export interface Span {
  content: string;
  bbox?: Bbox;
  html?: string;
  chars?: Array<{ content: string; bbox: Bbox }>;
}
export interface Line {
  spans: Span[];
  bbox?: Bbox;
}
export interface TableCell {
  row: number;
  col: number;
  rowspan?: number;
  colspan?: number;
  text: string;
  bbox?: Bbox;
  coordinate_precision?: CoordinatePrecision;
}
export interface Block {
  type?: string;
  bbox?: Bbox;
  lines?: Line[];
  blocks?: Block[];
  index?: number;
  page?: number;
  text?: string;
  html?: string;
  cells?: TableCell[];
}
export interface PageInfo {
  page_idx: number;
  page_size?: [number, number];
  para_blocks?: Block[];
}
export interface ContractData {
  pdf_info?: PageInfo[];
  paragraphs?: Block[];
  tables?: Block[];
  pdf_url?: string;
  metadata?: {
    page_sizes?: Array<{ page_idx: number; width: number; height: number }>;
    [key: string]: unknown;
  };
}
export interface TextSegment {
  text: string;
  pageIdx: number;
  blockIdx: number;
  lineIdx: number;
  spanIdx: number;
  bbox?: Bbox;
  pageSize?: [number, number];
  precision?: CoordinatePrecision;
  startOffset: number;
  endOffset: number;
}
export interface TextUnit {
  text: string;
  kind: string;
  structure: string;
  anchor?: string;
  startOffset: number;
  endOffset: number;
  blockIdx: number;
}
export type DiffType = 'added' | 'removed' | 'unchanged' | 'moved';
export interface DiffChange {
  type: DiffType;
  operation?: 'modified';
  text: string;
  leftText?: string;
  rightText?: string;
  diffId?: number;
  leftStartOffset?: number;
  leftEndOffset?: number;
  rightStartOffset?: number;
  rightEndOffset?: number;
}
export interface RenderSegment {
  text: string;
  type: DiffType;
  pageIdx: number;
  blockIdx?: number;
  bbox?: Bbox;
  pageSize?: [number, number];
  precision?: CoordinatePrecision;
  diffId?: number;
}
export interface SideDiffResult {
  segments: RenderSegment[];
  fullText: string;
  textSegments: TextSegment[];
}
export interface TextDiffResultV2 {
  left: SideDiffResult;
  right: SideDiffResult;
  changes: DiffChange[];
  stats: DiffStats;
  metadata?: {
    engineVersion: string;
    buildRevision?: string;
    options: Record<string, unknown>;
    durationMs: number;
    warnings: string[];
  };
}
export interface DiffStats {
  totalChanges: number;
  additions: number;
  deletions: number;
  modifications: number;
  moves: number;
  unchangedChars: number;
  addedChars: number;
  removedChars: number;
}
