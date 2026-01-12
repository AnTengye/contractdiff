// Annotation builder - creates visual annotations from text diffs

import type { CharacterDiff, DiffTuple } from '../text/types';
import type { 
  VisualBlock, 
  VisualAnnotation,
  CharacterMap 
} from './types';
import { buildCharacterMap, splitBBoxByLines } from './characterMapper';

/**
 * Build visual annotations from text diffs
 */
export function buildAnnotations(
  diffs: CharacterDiff[],
  leftBlocks: VisualBlock[],
  rightBlocks: VisualBlock[]
): {
  leftAnnotations: Map<number, VisualAnnotation[]>;
  rightAnnotations: Map<number, VisualAnnotation[]>;
  stats: { totalAnnotations: number; mappedChars: number; unmappedChars: number };
} {
  const leftAnnotations = new Map<number, VisualAnnotation[]>();
  const rightAnnotations = new Map<number, VisualAnnotation[]>();
  
  let totalAnnotations = 0;
  let mappedChars = 0;
  let unmappedChars = 0;
  
  for (let diffIndex = 0; diffIndex < diffs.length; diffIndex++) {
    const diff = diffs[diffIndex]!;
    
    if (!diff.hasDiff) continue;
    
    const leftBlock = diff.leftBlock.index >= 0 
      ? leftBlocks.find(b => b.index === diff.leftBlock.index)
      : null;
    
    const rightBlock = diff.rightBlock.index >= 0
      ? rightBlocks.find(b => b.index === diff.rightBlock.index)
      : null;
    
    // Build character maps
    const leftCharMap = leftBlock ? buildCharacterMap(leftBlock) : null;
    const rightCharMap = rightBlock ? buildCharacterMap(rightBlock) : null;
    
    // Process diff tuples and create annotations
    const result = processDiffTuples(
      diff.diffs,
      leftCharMap,
      rightCharMap,
      diffIndex,
      leftBlock || undefined,
      rightBlock || undefined
    );
    
    // Add to annotations map
    for (const annotation of result.leftAnnotations) {
      const pageIdx = annotation.pageIdx;
      if (!leftAnnotations.has(pageIdx)) {
        leftAnnotations.set(pageIdx, []);
      }
      leftAnnotations.get(pageIdx)!.push(annotation);
      totalAnnotations++;
    }
    
    for (const annotation of result.rightAnnotations) {
      const pageIdx = annotation.pageIdx;
      if (!rightAnnotations.has(pageIdx)) {
        rightAnnotations.set(pageIdx, []);
      }
      rightAnnotations.get(pageIdx)!.push(annotation);
      totalAnnotations++;
    }
    
    mappedChars += result.mappedChars;
    unmappedChars += result.unmappedChars;
  }
  
  const totalChars = mappedChars + unmappedChars;
  const coveragePercent = totalChars > 0 ? ((mappedChars / totalChars) * 100).toFixed(1) : '0.0';
  
  console.log(`[AnnotationBuilder] Created ${totalAnnotations} annotations`);
  console.log(`[AnnotationBuilder] Mapped ${mappedChars} chars, unmapped ${unmappedChars} chars (${coveragePercent}% coverage)`);
  
  return {
    leftAnnotations,
    rightAnnotations,
    stats: { totalAnnotations, mappedChars, unmappedChars },
  };
}

/**
 * Process diff tuples and create annotations
 */
function processDiffTuples(
  diffs: DiffTuple[],
  leftCharMap: CharacterMap | null,
  rightCharMap: CharacterMap | null,
  diffIndex: number,
  leftBlock?: VisualBlock,
  rightBlock?: VisualBlock
): {
  leftAnnotations: VisualAnnotation[];
  rightAnnotations: VisualAnnotation[];
  mappedChars: number;
  unmappedChars: number;
} {
  const leftAnnotations: VisualAnnotation[] = [];
  const rightAnnotations: VisualAnnotation[] = [];
  
  let leftCharPos = 0;
  let rightCharPos = 0;
  let mappedChars = 0;
  let unmappedChars = 0;
  
  for (const [op, text] of diffs) {
    const textLen = text.length;
    
    if (op === -1) {
      // Deletion - annotate on left side
      if (leftCharMap) {
        const bboxes = splitBBoxByLines(leftCharMap, leftCharPos, leftCharPos + textLen);
        
        if (bboxes.length > 0) {
          for (const bbox of bboxes) {
            leftAnnotations.push({
              type: 'removed',
              bbox,
              pageIdx: leftCharMap.pageIdx,
              pageSize: leftCharMap.positions[0]?.pageSize || [612, 792],
              diffIndex,
              text: text.substring(0, 100),
              charStart: leftCharPos,
              charEnd: leftCharPos + textLen,
            });
          }
          mappedChars += textLen;
        } else {
          // Fallback: use block-level bbox if available
          const fallbackBBox = getBlockLevelFallbackBBox(leftBlock, leftCharPos, textLen);
          if (fallbackBBox) {
            leftAnnotations.push({
              type: 'removed',
              bbox: fallbackBBox,
              pageIdx: leftCharMap.pageIdx,
              pageSize: leftCharMap.positions[0]?.pageSize || [612, 792],
              diffIndex,
              text: text.substring(0, 100),
              charStart: leftCharPos,
              charEnd: leftCharPos + textLen,
            });
            mappedChars += textLen;
          } else {
            unmappedChars += textLen;
          }
        }
      } else {
        unmappedChars += textLen;
      }
      
      leftCharPos += textLen;
      
    } else if (op === 1) {
      // Insertion - annotate on right side
      if (rightCharMap) {
        const bboxes = splitBBoxByLines(rightCharMap, rightCharPos, rightCharPos + textLen);
        
        if (bboxes.length > 0) {
          for (const bbox of bboxes) {
            rightAnnotations.push({
              type: 'added',
              bbox,
              pageIdx: rightCharMap.pageIdx,
              pageSize: rightCharMap.positions[0]?.pageSize || [612, 792],
              diffIndex,
              text: text.substring(0, 100),
              charStart: rightCharPos,
              charEnd: rightCharPos + textLen,
            });
          }
          mappedChars += textLen;
        } else {
          // Fallback: use block-level bbox if available
          const fallbackBBox = getBlockLevelFallbackBBox(rightBlock, rightCharPos, textLen);
          if (fallbackBBox) {
            rightAnnotations.push({
              type: 'added',
              bbox: fallbackBBox,
              pageIdx: rightCharMap.pageIdx,
              pageSize: rightCharMap.positions[0]?.pageSize || [612, 792],
              diffIndex,
              text: text.substring(0, 100),
              charStart: rightCharPos,
              charEnd: rightCharPos + textLen,
            });
            mappedChars += textLen;
          } else {
            unmappedChars += textLen;
          }
        }
      } else {
        unmappedChars += textLen;
      }
      
      rightCharPos += textLen;
      
    } else {
      // Equal - no annotation, just advance positions
      leftCharPos += textLen;
      rightCharPos += textLen;
    }
  }
  
  return {
    leftAnnotations,
    rightAnnotations,
    mappedChars,
    unmappedChars,
  };
}

/**
 * Get block-level bbox as fallback when character-level mapping fails
 */
function getBlockLevelFallbackBBox(
  block: VisualBlock | undefined,
  charStart: number,
  charLen: number
): [number, number, number, number] | null {
  if (!block || !block.bbox) return null;
  
  const [x0, y0, x1, y1] = block.bbox;
  
  // Check if bbox is valid (not all zeros)
  if (x0 === 0 && y0 === 0 && x1 === 0 && y1 === 0) {
    return null;
  }
  
  // If the entire block text is being annotated, use the full bbox
  if (charStart === 0 && charLen >= block.text.length) {
    return block.bbox;
  }
  
  // Otherwise, try to estimate the partial bbox based on character position
  // This is a rough approximation
  const totalChars = Math.max(block.text.length, 1);
  const startRatio = charStart / totalChars;
  const endRatio = (charStart + charLen) / totalChars;
  
  const width = x1 - x0;
  const estimatedX0 = x0 + width * startRatio;
  const estimatedX1 = x0 + width * endRatio;
  
  return [estimatedX0, y0, estimatedX1, y1];
}

/**
 * Merge adjacent annotations of the same type to reduce rendering overhead
 */
export function mergeAdjacentAnnotations(
  annotations: VisualAnnotation[],
  distanceThreshold: number = 2
): VisualAnnotation[] {
  if (annotations.length <= 1) return annotations;
  
  // Sort by position
  const sorted = [...annotations].sort((a, b) => {
    if (a.pageIdx !== b.pageIdx) return a.pageIdx - b.pageIdx;
    return a.bbox[1] - b.bbox[1]; // Sort by Y position
  });
  
  const merged: VisualAnnotation[] = [];
  let current = sorted[0]!;
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    
    // Check if can merge
    if (
      current.type === next.type &&
      current.pageIdx === next.pageIdx &&
      current.diffIndex === next.diffIndex &&
      canMergeBBoxes(current.bbox, next.bbox, distanceThreshold)
    ) {
      // Merge bboxes
      current.bbox = mergeBBoxes(current.bbox, next.bbox);
      current.charEnd = next.charEnd;
      current.text = current.text + '...' + next.text;
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  
  return merged;
}

/**
 * Check if two bboxes can be merged (are adjacent or overlapping)
 */
function canMergeBBoxes(bbox1: [number, number, number, number], bbox2: [number, number, number, number], threshold: number): boolean {
  const [x1_0, y1_0, x1_1, y1_1] = bbox1;
  const [x2_0, y2_0, x2_1, y2_1] = bbox2;
  
  // Check Y overlap (same line)
  const yOverlap = Math.min(y1_1, y2_1) - Math.max(y1_0, y2_0);
  const yHeight = Math.min(y1_1 - y1_0, y2_1 - y2_0);
  
  if (yOverlap < yHeight * 0.5) return false;
  
  // Check X distance
  const xDistance = Math.max(x2_0 - x1_1, x1_0 - x2_1);
  
  return xDistance <= threshold;
}

/**
 * Merge two bboxes into one
 */
function mergeBBoxes(bbox1: [number, number, number, number], bbox2: [number, number, number, number]): [number, number, number, number] {
  return [
    Math.min(bbox1[0], bbox2[0]),
    Math.min(bbox1[1], bbox2[1]),
    Math.max(bbox1[2], bbox2[2]),
    Math.max(bbox1[3], bbox2[3]),
  ];
}
