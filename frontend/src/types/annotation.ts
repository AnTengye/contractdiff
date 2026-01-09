// Annotation types
export type AnnotationType = 'added' | 'removed' | 'modified';

export interface Annotation {
  bbox: [number, number, number, number];
  pageSize: [number, number];
  type: AnnotationType;
  text: string;
  pairId?: string;
  paragraphIdx?: number;  // Link back to paragraph diff for navigation
}

// Track annotation preparation results
export interface UnmappedDiff {
  type: 'added' | 'removed';
  text: string;
  paragraphIdx: number;
  reason: string;
}

export interface AnnotationResult {
  leftAnnotations: Annotations;
  rightAnnotations: Annotations;
  mappedCount: number;
  unmappedCount: number;
  unmappedDiffs: UnmappedDiff[];
}

export interface Annotations {
  [pageIdx: number]: Annotation[];
}
