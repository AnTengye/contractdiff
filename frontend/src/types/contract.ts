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
}

export interface PageInfo {
  page_idx: number;
  page_size?: [number, number];
  para_blocks?: Block[];
}

export interface ContractData {
  pdf_info: PageInfo[];
  pdf_url?: string;
}

export interface Paragraph {
  text: string;
  type?: string;
  pageIdx: number;
}

export interface BlockWithBbox {
  text: string;
  bbox: [number, number, number, number];
  pageIdx: number;
  pageSize: [number, number];
}
