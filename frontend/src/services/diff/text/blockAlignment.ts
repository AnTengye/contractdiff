// Block alignment algorithm for matching left and right blocks
// Implements the "Smart Match" strategy from the legacy version

import type { TextBlock, BlockAlignment } from './types';
import { calculateTextSimilarity } from './characterDiff';

/**
 * Default similarity threshold for considering blocks as matched
 */
const SIMILARITY_THRESHOLD = 0.85;

/**
 * Options for block alignment
 */
export interface AlignmentOptions {
  /** Minimum similarity threshold for matching blocks */
  threshold?: number;
  /** Unused in legacy logic but kept for interface compatibility */
  positionWeight?: number;
  /** Unused in legacy logic but kept for interface compatibility */
  similarityWeight?: number;
  /** Unused in legacy logic but kept for interface compatibility */
  usePositionScoring?: boolean;
}

/**
 * Extract section number from text (e.g. "1.1", "第一条")
 */
function extractSectionNumber(text: string): string | null {
  if (!text) return null;

  // Trim leading/trailing whitespace
  const trimmed = text.trim();

  // Match patterns
  const patterns = [
    // Arabic numerals: 1. 1.1 1.1.1 1、 1）
    /^(\d+(?:\.\d+)*)[.、）)]\s*/,
    // Chinese numerals: 一、 （一） 第一条 第一章
    /^[（(]?([一二三四五六七八九十]+)[）)、]\s*/,
    /^第([一二三四五六七八九十\d]+)[条章节款项]\s*/,
    // Parenthesized Arabic numerals: (1) （1）
    /^[（(](\d+)[）)]\s*/,
    // Letter sequences: a. A. a) A)
    /^([a-zA-Z])[.）)]\s*/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Normalize number string (Chinese to Arabic)
 */
function normalizeNumber(num: string): string {
  if (!num) return '';

  const chineseNums: Record<string, string> = {
    '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
    '六': '6', '七': '7', '八': '8', '九': '9', '十': '10',
    '十一': '11', '十二': '12', '十三': '13', '十四': '14', '十五': '15'
  };

  // Convert Chinese number if match found
  if (chineseNums[num]) {
    return chineseNums[num];
  }

  return num.toLowerCase();
}

/**
 * Align blocks from left and right documents using 3-phase strategy:
 * 1. Section Number Matching (Exact)
 * 2. Text Similarity Matching (Best match > threshold)
 * 3. Fallback (Additions/Deletions)
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

  // Phase 1: Match by Section Number (Highest Priority)
  for (let i = 0; i < leftBlocks.length; i++) {
    const leftBlock = leftBlocks[i]!;
    const num1 = extractSectionNumber(leftBlock.text);
    if (!num1) continue;

    const normNum1 = normalizeNumber(num1);

    for (let j = 0; j < rightBlocks.length; j++) {
      if (matchedRight.has(j)) continue;

      const rightBlock = rightBlocks[j]!;
      const num2 = extractSectionNumber(rightBlock.text);
      if (!num2) continue;

      const normNum2 = normalizeNumber(num2);

      if (normNum1 === normNum2) {
        matchedLeft.add(i);
        matchedRight.add(j);
        
        const textSim = calculateTextSimilarity(leftBlock.text, rightBlock.text);
        
        alignments.push({
          leftIndex: i,
          rightIndex: j,
          matchType: 'exact', // Treat number match as structural anchor
          similarity: textSim
        });
        break;
      }
    }
  }

  // Phase 2: Match by Text Similarity
  for (let i = 0; i < leftBlocks.length; i++) {
    if (matchedLeft.has(i)) continue;

    let bestMatch = -1;
    let bestScore = threshold;

    for (let j = 0; j < rightBlocks.length; j++) {
      if (matchedRight.has(j)) continue;

      const similarity = calculateTextSimilarity(
        leftBlocks[i]!.text,
        rightBlocks[j]!.text
      );

      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatch = j;
      }
    }

    if (bestMatch !== -1) {
      matchedLeft.add(i);
      matchedRight.add(bestMatch);
      
      alignments.push({
        leftIndex: i,
        rightIndex: bestMatch,
        matchType: 'similar',
        similarity: bestScore
      });
    }
  }

  // Phase 3: Handle Unmatched (Deletions)
  for (let i = 0; i < leftBlocks.length; i++) {
    if (!matchedLeft.has(i)) {
      alignments.push({
        leftIndex: i,
        rightIndex: null,
        matchType: 'unmatched',
        similarity: 0
      });
    }
  }

  // Phase 3: Handle Unmatched (Additions)
  for (let j = 0; j < rightBlocks.length; j++) {
    if (!matchedRight.has(j)) {
      alignments.push({
        leftIndex: null,
        rightIndex: j,
        matchType: 'unmatched',
        similarity: 0
      });
    }
  }

  // Sort alignments by page number and block index
  alignments.sort((a, b) => {
    // Get block info for sorting
    const getBlockInfo = (alignment: BlockAlignment) => {
      // Prefer left block if it exists, otherwise use right block
      const blockIndex = alignment.leftIndex !== null ? alignment.leftIndex : alignment.rightIndex;
      if (blockIndex === null) return { pageIdx: 999999, index: 999999 };
      
      const block = alignment.leftIndex !== null 
        ? leftBlocks[alignment.leftIndex]! 
        : rightBlocks[alignment.rightIndex!]!;
      
      return {
        pageIdx: block.pageIdx,
        index: block.index,
      };
    };
    
    const aInfo = getBlockInfo(a);
    const bInfo = getBlockInfo(b);
    
    // Sort by page first, then by block index within page
    if (aInfo.pageIdx !== bInfo.pageIdx) {
      return aInfo.pageIdx - bInfo.pageIdx;
    }
    return aInfo.index - bInfo.index;
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
