// Block alignment algorithm for matching left and right blocks

import type { TextBlock, BlockAlignment } from './types';
import { calculateTextSimilarity } from './characterDiff';

/**
 * Default similarity threshold for considering blocks as matched
 * Lower threshold = more lenient matching (may match dissimilar blocks)
 * Higher threshold = stricter matching (may miss similar blocks with minor differences)
 * 
 * Lowered from 0.6 to 0.5 to catch more similar blocks with OCR artifacts
 */
const SIMILARITY_THRESHOLD = 0.5;

/**
 * Threshold for exact match consideration
 */
const EXACT_MATCH_THRESHOLD = 0.98;

/**
 * Weight for position proximity in scoring (0.0 to 1.0)
 * Higher value = position matters more
 */
const POSITION_WEIGHT = 0.3;

/**
 * Weight for text similarity in scoring (0.0 to 1.0)
 * Higher value = text content matters more
 */
const SIMILARITY_WEIGHT = 0.7;

/**
 * Options for block alignment
 */
export interface AlignmentOptions {
  /** Minimum similarity threshold for matching blocks */
  threshold?: number;
  /** Weight for position proximity (0-1) */
  positionWeight?: number;
  /** Weight for text similarity (0-1) */
  similarityWeight?: number;
  /** Use position-aware scoring */
  usePositionScoring?: boolean;
}

/**
 * Calculate position proximity score between two blocks
 * Returns a value between 0 and 1, where 1 = same position
 */
function calculatePositionScore(
  leftIndex: number,
  rightIndex: number,
  leftTotal: number,
  rightTotal: number
): number {
  // Normalize positions to 0-1 range
  const leftPos = leftTotal > 1 ? leftIndex / (leftTotal - 1) : 0;
  const rightPos = rightTotal > 1 ? rightIndex / (rightTotal - 1) : 0;
  
  // Calculate distance (0 to 1)
  const distance = Math.abs(leftPos - rightPos);
  
  // Convert to proximity score (1 = close, 0 = far)
  return 1 - distance;
}

/**
 * Calculate combined score using text similarity and position proximity
 */
function calculateCombinedScore(
  textSimilarity: number,
  leftIndex: number,
  rightIndex: number,
  leftTotal: number,
  rightTotal: number,
  options: AlignmentOptions
): number {
  const simWeight = options.similarityWeight ?? SIMILARITY_WEIGHT;
  const posWeight = options.positionWeight ?? POSITION_WEIGHT;
  
  if (!options.usePositionScoring) {
    return textSimilarity;
  }
  
  const positionScore = calculatePositionScore(leftIndex, rightIndex, leftTotal, rightTotal);
  
  // Weighted combination
  return textSimilarity * simWeight + positionScore * posWeight;
}

/**
 * Align blocks from left and right documents
 * Uses an improved greedy matching algorithm with position-aware scoring
 */
export function alignBlocks(
  leftBlocks: TextBlock[],
  rightBlocks: TextBlock[],
  options: AlignmentOptions = {}
): BlockAlignment[] {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;
  const alignments: BlockAlignment[] = [];
  const matchedLeft = new Set<number>();
  const matchedRight = new Set<number>();
  
  // Build similarity matrix
  const similarityMatrix: number[][] = [];
  const scoreMatrix: number[][] = [];
  
  for (let i = 0; i < leftBlocks.length; i++) {
    similarityMatrix[i] = [];
    scoreMatrix[i] = [];
    
    for (let j = 0; j < rightBlocks.length; j++) {
      const textSim = calculateTextSimilarity(
        leftBlocks[i]!.text,
        rightBlocks[j]!.text
      );
      similarityMatrix[i]![j] = textSim;
      
      // Calculate combined score with position weighting
      const score = calculateCombinedScore(
        textSim,
        i,
        j,
        leftBlocks.length,
        rightBlocks.length,
        options
      );
      scoreMatrix[i]![j] = score;
      
      // Debug: log high similarity blocks that might be missed
      if (textSim > 0.9 && textSim < EXACT_MATCH_THRESHOLD) {
        console.log(`[BlockAlign] High similarity (${textSim.toFixed(3)}):`, {
          left: `Block ${i}: ${leftBlocks[i]!.text.substring(0, 50)}...`,
          right: `Block ${j}: ${rightBlocks[j]!.text.substring(0, 50)}...`
        });
      }
    }
  }
  
  // Greedy matching: find best matches above threshold using combined score
  while (true) {
    let bestScore = -1;
    let bestLeft = -1;
    let bestRight = -1;
    
    for (let i = 0; i < leftBlocks.length; i++) {
      if (matchedLeft.has(i)) continue;
      
      for (let j = 0; j < rightBlocks.length; j++) {
        if (matchedRight.has(j)) continue;
        
        const textSim = similarityMatrix[i]![j]!;
        const score = scoreMatrix[i]![j]!;
        
        // Only consider matches above text similarity threshold
        if (textSim >= threshold && score > bestScore) {
          bestScore = score;
          bestLeft = i;
          bestRight = j;
        }
      }
    }
    
    if (bestLeft === -1) break;
    
    matchedLeft.add(bestLeft);
    matchedRight.add(bestRight);
    
    const textSim = similarityMatrix[bestLeft]![bestRight]!;
    
    alignments.push({
      leftIndex: bestLeft,
      rightIndex: bestRight,
      matchType: textSim >= 0.95 ? 'exact' : 'similar',
      similarity: textSim,
    });
  }
  
  // Add unmatched left blocks (deletions)
  for (let i = 0; i < leftBlocks.length; i++) {
    if (!matchedLeft.has(i)) {
      // Debug: Check if this unmatched block has high similarity with any right block
      const bestSimilarity = Math.max(...(similarityMatrix[i] || [0]));
      if (bestSimilarity > 0.7) {
        const bestRightIndex = similarityMatrix[i]!.indexOf(bestSimilarity);
        const posScore = calculatePositionScore(i, bestRightIndex, leftBlocks.length, rightBlocks.length);
        console.warn(`[BlockAlign] Potential missed match - Left block ${i} (text_sim=${bestSimilarity.toFixed(3)}, pos_score=${posScore.toFixed(3)} with Right ${bestRightIndex}):`, {
          leftText: leftBlocks[i]!.text.substring(0, 100),
          reason: matchedRight.has(bestRightIndex) ? 'Right block already matched to another left block' : 'Similarity below threshold'
        });
      }
      
      alignments.push({
        leftIndex: i,
        rightIndex: null,
        matchType: 'unmatched',
        similarity: 0,
      });
    }
  }
  
  // Add unmatched right blocks (additions)
  for (let j = 0; j < rightBlocks.length; j++) {
    if (!matchedRight.has(j)) {
      // Debug: Check if this unmatched block has high similarity with any left block
      let bestSimilarity = 0;
      let bestLeftIndex = -1;
      for (let i = 0; i < leftBlocks.length; i++) {
        if (similarityMatrix[i]![j]! > bestSimilarity) {
          bestSimilarity = similarityMatrix[i]![j]!;
          bestLeftIndex = i;
        }
      }
      
      if (bestSimilarity > 0.7) {
        const posScore = calculatePositionScore(bestLeftIndex, j, leftBlocks.length, rightBlocks.length);
        console.warn(`[BlockAlign] Potential missed match - Right block ${j} (text_sim=${bestSimilarity.toFixed(3)}, pos_score=${posScore.toFixed(3)} with Left ${bestLeftIndex}):`, {
          rightText: rightBlocks[j]!.text.substring(0, 100),
          reason: matchedLeft.has(bestLeftIndex) ? 'Left block already matched to another right block' : 'Similarity below threshold'
        });
      }
      
      alignments.push({
        leftIndex: null,
        rightIndex: j,
        matchType: 'unmatched',
        similarity: 0,
      });
    }
  }
  
  // Sort alignments by position (left first, then right)
  alignments.sort((a, b) => {
    const aPos = a.leftIndex !== null ? a.leftIndex : 1000000 + (a.rightIndex || 0);
    const bPos = b.leftIndex !== null ? b.leftIndex : 1000000 + (b.rightIndex || 0);
    return aPos - bPos;
  });
  
  return alignments;
}

/**
 * Calculate alignment statistics
 */
export function calculateAlignmentStats(
  alignments: BlockAlignment[],
  leftCount: number,
  rightCount: number
) {
  let matched = 0;
  let added = 0;
  let deleted = 0;
  let modified = 0;
  
  for (const align of alignments) {
    if (align.matchType === 'exact') {
      matched++;
    } else if (align.matchType === 'similar') {
      modified++;
    } else if (align.leftIndex === null) {
      added++;
    } else {
      deleted++;
    }
  }
  
  return {
    totalBlocks: Math.max(leftCount, rightCount),
    matchedBlocks: matched,
    addedBlocks: added,
    deletedBlocks: deleted,
    modifiedBlocks: modified,
  };
}
