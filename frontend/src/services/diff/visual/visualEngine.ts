// Visual diff engine - orchestrates visual comparison

import type { CharacterDiff } from '../text/types';
import type { VisualBlock, VisualDiffResult } from './types';
import { buildAnnotations, mergeAdjacentAnnotations } from './annotationBuilder';

/**
 * Compute visual diff from text diff results
 */
export function computeVisualDiff(
  textDiffs: CharacterDiff[],
  leftBlocks: VisualBlock[],
  rightBlocks: VisualBlock[],
  options: {
    mergeAnnotations?: boolean;
  } = {}
): VisualDiffResult {
  console.log(`[VisualEngine] Processing ${textDiffs.length} diffs for visual annotation`);
  console.log(`[VisualEngine] Left blocks: ${leftBlocks.length}, Right blocks: ${rightBlocks.length}`);
  
  // Build annotations from diffs
  const { leftAnnotations, rightAnnotations, stats } = buildAnnotations(
    textDiffs,
    leftBlocks,
    rightBlocks
  );
  
  // Optionally merge adjacent annotations
  if (options.mergeAnnotations) {
    for (const [pageIdx, annotations] of leftAnnotations.entries()) {
      leftAnnotations.set(pageIdx, mergeAdjacentAnnotations(annotations));
    }
    
    for (const [pageIdx, annotations] of rightAnnotations.entries()) {
      rightAnnotations.set(pageIdx, mergeAdjacentAnnotations(annotations));
    }
  }
  
  const totalAnnotations = 
    Array.from(leftAnnotations.values()).reduce((sum, arr) => sum + arr.length, 0) +
    Array.from(rightAnnotations.values()).reduce((sum, arr) => sum + arr.length, 0);
  
  console.log(`[VisualEngine] Generated ${totalAnnotations} visual annotations`);
  
  return {
    leftAnnotations,
    rightAnnotations,
    stats: {
      totalAnnotations,
      mappedChars: stats.mappedChars,
      unmappedChars: stats.unmappedChars,
    },
  };
}

/**
 * Export visual diff for debugging
 */
export function exportVisualDiffDebug(result: VisualDiffResult): string {
  const lines: string[] = [];
  
  lines.push('=== Visual Diff Results ===');
  lines.push(`Total Annotations: ${result.stats.totalAnnotations}`);
  lines.push(`Mapped Characters: ${result.stats.mappedChars}`);
  lines.push(`Unmapped Characters: ${result.stats.unmappedChars}`);
  lines.push('');
  
  lines.push('Left Annotations:');
  for (const [pageIdx, annotations] of result.leftAnnotations.entries()) {
    lines.push(`  Page ${pageIdx}: ${annotations.length} annotations`);
    for (const ann of annotations.slice(0, 5)) {
      lines.push(`    ${ann.type}: bbox=${ann.bbox.map(n => n.toFixed(1)).join(',')}, text="${ann.text.substring(0, 30)}..."`);
    }
  }
  lines.push('');
  
  lines.push('Right Annotations:');
  for (const [pageIdx, annotations] of result.rightAnnotations.entries()) {
    lines.push(`  Page ${pageIdx}: ${annotations.length} annotations`);
    for (const ann of annotations.slice(0, 5)) {
      lines.push(`    ${ann.type}: bbox=${ann.bbox.map(n => n.toFixed(1)).join(',')}, text="${ann.text.substring(0, 30)}..."`);
    }
  }
  
  return lines.join('\n');
}
