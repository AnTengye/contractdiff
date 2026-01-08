// Annotation types
export type AnnotationType = 'added' | 'removed';

export interface Annotation {
  bbox: [number, number, number, number];
  pageSize: [number, number];
  type: AnnotationType;
  text: string;
  pairId?: string;
}

export interface Annotations {
  [pageIdx: number]: Annotation[];
}
