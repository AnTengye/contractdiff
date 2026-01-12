// Visual diff types for precise PDF annotation

import type { TextBlock } from '../text/types';

/**
 * Bounding box in PDF coordinates [x0, y0, x1, y1]
 * Origin is bottom-left corner
 */
export type BBox = [number, number, number, number];

/**
 * Character position with bbox
 */
export interface CharPosition {
  char: string;
  charIndex: number;      // Index in the block text
  bbox: BBox;
  pageIdx: number;
  pageSize: [number, number];
}

/**
 * Text span with position info from PDF
 */
export interface TextSpan {
  content: string;
  bbox: BBox;
  // Font info (optional)
  fontName?: string;
  fontSize?: number;
}

/**
 * Text line in PDF
 */
export interface TextLine {
  spans: TextSpan[];
  bbox: BBox;
}

/**
 * Block with detailed position information
 */
export interface VisualBlock extends TextBlock {
  bbox: BBox;
  pageSize: [number, number];
  lines: TextLine[];
}

/**
 * Character-to-bbox mapping for a block
 */
export interface CharacterMap {
  blockIndex: number;
  pageIdx: number;
  totalChars: number;
  positions: CharPosition[];
}

/**
 * Annotation type
 */
export type AnnotationType = 'added' | 'removed' | 'modified';

/**
 * Visual annotation for rendering on PDF
 */
export interface VisualAnnotation {
  type: AnnotationType;
  bbox: BBox;
  pageIdx: number;
  pageSize: [number, number];
  // Link to source diff
  diffIndex: number;
  // Text preview
  text: string;
  // Character range in the original text
  charStart: number;
  charEnd: number;
}

/**
 * Complete visual diff result
 */
export interface VisualDiffResult {
  leftAnnotations: Map<number, VisualAnnotation[]>;  // pageIdx -> annotations
  rightAnnotations: Map<number, VisualAnnotation[]>;
  stats: {
    totalAnnotations: number;
    mappedChars: number;
    unmappedChars: number;
  };
}
