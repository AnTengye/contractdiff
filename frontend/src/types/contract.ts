// Contract types
export type FileType = 'pdf' | 'docx';

export interface CancelToken {
  cancelled: boolean;
}

export interface Span {
  content: string;
  bbox?: [number, number, number, number];
}

export interface Line {
  spans: Span[];
}

export interface Block {
  type?: string;
  bbox?: [number, number, number, number];
  lines?: Line[];
  blocks?: Block[];
  index?: number;  // Block index (for normalized format)
  page?: number;   // Page number, 1-indexed (for normalized format)
  angle?: number;
}

export interface PageInfo {
  page_idx: number;
  page_size?: [number, number];
  para_blocks?: Block[];
}

// ContractData can be in raw MinerU format (pdf_info) or normalized format (paragraphs)
export interface ContractData {
  // Raw MinerU format
  pdf_info?: PageInfo[];
  pdf_url?: string;
  // Normalized format
  paragraphs?: Block[];
  tables?: Block[];
  images?: Block[];
  metadata?: Record<string, unknown>;
}

// Block reference for visual mapping
export interface BlockReference {
  blockIdx: number;
  pageIdx: number;
  bbox: [number, number, number, number];
  pageSize: [number, number];
  text: string;
}

export interface Paragraph {
  text: string;
  type?: string;
  pageIdx: number;
  sourceBlocks?: BlockReference[];  // Source block references for visual annotation
}

export interface BlockWithBbox {
  text: string;
  bbox: [number, number, number, number];
  pageIdx: number;
  pageSize: [number, number];
}
