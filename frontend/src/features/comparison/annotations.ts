// Annotation preparation for PDF/DOCX highlighting
import { pdfActions, diffStore, diffActions } from '@/store';
import { COLORS } from '@/constants';
import type { Annotations, Annotation, AnnotationType, AnnotationResult, UnmappedDiff, BlockReference } from '@/types';
import type { DiffTuple } from '@/types';

/**
 * Classify diff type based on operations in a paragraph
 */
function classifyDiffType(diffs: DiffTuple[]): AnnotationType {
  let hasAdd = false;
  let hasRemove = false;

  for (const [op, text] of diffs) {
    if (text.trim()) {
      if (op === 1) hasAdd = true;
      if (op === -1) hasRemove = true;
    }
  }

  if (hasAdd && hasRemove) return 'modified';
  if (hasAdd) return 'added';
  return 'removed';
}

/**
 * Add annotation to the collection
 */
function addAnnotation(
  annotations: Annotations,
  block: BlockReference,
  type: AnnotationType,
  text: string,
  pairId: string,
  paragraphIdx: number
): void {
  const pageIdx = block.pageIdx;
  if (!annotations[pageIdx]) {
    annotations[pageIdx] = [];
  }
  annotations[pageIdx]!.push({
    bbox: block.bbox,
    pageSize: block.pageSize,
    type,
    text,
    pairId,
    paragraphIdx,
  });
}

/**
 * Prepare annotations from diff results using paragraph-block linking
 * This ensures visual annotations match the text diff counts exactly
 */
export function prepareAnnotations(): AnnotationResult {
  const diffs = diffStore.getState().paragraphDiffs;

  const emptyResult: AnnotationResult = {
    leftAnnotations: {},
    rightAnnotations: {},
    mappedCount: 0,
    unmappedCount: 0,
    unmappedDiffs: [],
  };

  if (!diffs) {
    pdfActions.setAnnotations({}, {});
    return emptyResult;
  }

  const leftAnnotations: Annotations = {};
  const rightAnnotations: Annotations = {};
  const unmappedDiffs: UnmappedDiff[] = [];

  let mappedCount = 0;
  let unmappedCount = 0;
  let pairId = 0;

  // Track which blocks have been annotated to avoid duplicates
  const annotatedLeftBlocks = new Set<string>();
  const annotatedRightBlocks = new Set<string>();

  for (let paragraphIdx = 0; paragraphIdx < diffs.length; paragraphIdx++) {
    const diff = diffs[paragraphIdx]!;
    if (!diff.hasDiff) continue;

    // Determine the type of change for this paragraph
    const changeType = classifyDiffType(diff.diffs);
    const currentPairId = `pair-${pairId++}`;

    // For removed or modified content, annotate left side blocks
    if (changeType === 'removed' || changeType === 'modified') {
      const leftPara = diff.left;
      if (leftPara.sourceBlocks && leftPara.sourceBlocks.length > 0) {
        for (const block of leftPara.sourceBlocks) {
          // Create unique key for this block
          const blockKey = `${block.pageIdx}-${block.blockIdx}`;
          if (!annotatedLeftBlocks.has(blockKey)) {
            annotatedLeftBlocks.add(blockKey);
            addAnnotation(
              leftAnnotations,
              block,
              changeType === 'modified' ? 'modified' : 'removed',
              leftPara.text.substring(0, 100),
              currentPairId,
              paragraphIdx
            );
            mappedCount++;
          }
        }
      } else {
        // No block reference - track as unmapped
        unmappedDiffs.push({
          type: 'removed',
          text: leftPara.text.substring(0, 50) + (leftPara.text.length > 50 ? '...' : ''),
          paragraphIdx,
          reason: 'No source block reference',
        });
        unmappedCount++;
      }
    }

    // For added or modified content, annotate right side blocks
    if (changeType === 'added' || changeType === 'modified') {
      const rightPara = diff.right;
      if (rightPara.sourceBlocks && rightPara.sourceBlocks.length > 0) {
        for (const block of rightPara.sourceBlocks) {
          // Create unique key for this block
          const blockKey = `${block.pageIdx}-${block.blockIdx}`;
          if (!annotatedRightBlocks.has(blockKey)) {
            annotatedRightBlocks.add(blockKey);
            addAnnotation(
              rightAnnotations,
              block,
              changeType === 'modified' ? 'modified' : 'added',
              rightPara.text.substring(0, 100),
              currentPairId,
              paragraphIdx
            );
            mappedCount++;
          }
        }
      } else {
        unmappedDiffs.push({
          type: 'added',
          text: rightPara.text.substring(0, 50) + (rightPara.text.length > 50 ? '...' : ''),
          paragraphIdx,
          reason: 'No source block reference',
        });
        unmappedCount++;
      }
    }
  }

  // Update store with annotations
  pdfActions.setAnnotations(leftAnnotations, rightAnnotations);

  // Update visual stats in diff store
  diffActions.updateVisualStats(mappedCount, unmappedCount);

  // Log results for debugging
  if (unmappedCount > 0) {
    console.warn(`${unmappedCount} diffs could not be mapped to visual locations:`, unmappedDiffs);
  }
  console.log(`Visual annotations: ${mappedCount} mapped, ${unmappedCount} unmapped`);

  return {
    leftAnnotations,
    rightAnnotations,
    mappedCount,
    unmappedCount,
    unmappedDiffs,
  };
}

/**
 * Draw annotations on PDF overlay
 */
export function drawAnnotationsOnOverlay(
  overlay: SVGSVGElement,
  annotations: Annotation[],
  scale: number
): void {
  // Clear existing annotations
  overlay.innerHTML = '';

  for (const annotation of annotations) {
    const [x0, y0, x1, y1] = annotation.bbox;
    const [, pageHeight] = annotation.pageSize;

    // Convert from PDF coordinates (bottom-left origin) to SVG (top-left origin)
    const x = x0 * scale;
    const y = (pageHeight - y1) * scale;
    const width = (x1 - x0) * scale;
    const height = (y1 - y0) * scale;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));

    // Select colors based on annotation type
    let colors;
    switch (annotation.type) {
      case 'added':
        colors = COLORS.ADDED;
        break;
      case 'removed':
        colors = COLORS.REMOVED;
        break;
      case 'modified':
        colors = COLORS.MODIFIED;
        break;
      default:
        colors = COLORS.REMOVED;
    }

    rect.setAttribute('fill', colors.FILL);
    rect.setAttribute('stroke', colors.STROKE);
    rect.setAttribute('stroke-width', '1');

    if (annotation.pairId) {
      rect.dataset.pairId = annotation.pairId;
    }
    if (annotation.paragraphIdx !== undefined) {
      rect.dataset.paragraphIdx = String(annotation.paragraphIdx);
    }

    overlay.appendChild(rect);
  }
}
