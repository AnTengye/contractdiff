// Character mapper - maps text characters to bounding boxes

import type { 
  VisualBlock, 
  CharacterMap, 
  CharPosition,
  BBox 
} from './types';

/**
 * Build character-to-bbox mapping for a visual block
 */
export function buildCharacterMap(block: VisualBlock): CharacterMap {
  const positions: CharPosition[] = [];
  let charIndex = 0;
  
  // Check if block has valid lines and spans
  const hasValidLines = block.lines && block.lines.length > 0;
  const hasValidBBox = block.bbox && !isZeroBBox(block.bbox);
  
  if (hasValidLines) {
    // Use detailed line/span information
    for (const line of block.lines) {
      for (const span of line.spans) {
        const spanChars = span.content.length;
        
        if (spanChars === 0) continue;
        
        // Calculate bbox for each character
        const charBBoxes = distributeSpanBBox(span.bbox, span.content);
        
        for (let i = 0; i < spanChars; i++) {
          positions.push({
            char: span.content[i]!,
            charIndex: charIndex,
            bbox: charBBoxes[i]!,
            pageIdx: block.pageIdx,
            pageSize: block.pageSize,
          });
          charIndex++;
        }
      }
    }
  } else if (hasValidBBox && block.text) {
    // Fallback: use block-level bbox for the entire text
    console.warn(`[CharMapper] Block ${block.index} has no detailed spans, using block bbox fallback`);
    const charBBoxes = distributeSpanBBox(block.bbox, block.text);
    
    for (let i = 0; i < block.text.length; i++) {
      positions.push({
        char: block.text[i]!,
        charIndex: charIndex,
        bbox: charBBoxes[i]!,
        pageIdx: block.pageIdx,
        pageSize: block.pageSize,
      });
      charIndex++;
    }
  }
  
  // Log mapping statistics
  const mappingMethod = hasValidLines ? 'span-level' : 'block-level fallback';
  console.log(`[CharMapper] Block ${block.index}: ${charIndex} chars mapped using ${mappingMethod}`);
  
  return {
    blockIndex: block.index,
    pageIdx: block.pageIdx,
    totalChars: charIndex,
    positions,
  };
}

/**
 * Check if bbox is zero/invalid
 */
function isZeroBBox(bbox: BBox): boolean {
  return bbox[0] === 0 && bbox[1] === 0 && bbox[2] === 0 && bbox[3] === 0;
}

/**
 * Distribute span bbox across characters
 * Uses improved character width estimation for better accuracy
 */
function distributeSpanBBox(spanBBox: BBox, text: string): BBox[] {
  const [x0, y0, x1, y1] = spanBBox;
  const width = x1 - x0;
  const charCount = text.length;
  
  if (charCount === 0) return [];
  if (charCount === 1) return [spanBBox];
  
  // Validate bbox
  if (width <= 0 || x0 === 0 && y0 === 0 && x1 === 0 && y1 === 0) {
    // Invalid bbox, create minimal bboxes
    console.warn('[CharMapper] Invalid span bbox, using minimal fallback');
    return text.split('').map((_, i) => [x0 + i, y0, x0 + i + 1, y1]);
  }
  
  // Use character-specific width estimation
  const charWidths = estimateCharacterWidths(text, width);
  const bboxes: BBox[] = [];
  
  let currentX = x0;
  for (let i = 0; i < charCount; i++) {
    const charWidth = charWidths[i]!;
    const charX0 = currentX;
    const charX1 = currentX + charWidth;
    bboxes.push([charX0, y0, charX1, y1]);
    currentX = charX1;
  }
  
  return bboxes;
}

/**
 * Estimate individual character widths based on character type
 * This provides better accuracy than uniform distribution
 */
function estimateCharacterWidths(text: string, totalWidth: number): number[] {
  const charCount = text.length;
  
  // Assign relative width to each character based on type
  const relativeWidths: number[] = [];
  let totalRelativeWidth = 0;
  
  for (let i = 0; i < charCount; i++) {
    const char = text[i]!;
    let relWidth = 1.0; // Default width
    
    // Adjust for character type
    if (char === ' ') {
      relWidth = 0.5; // Spaces are narrower
    } else if (char === '\t') {
      relWidth = 2.0; // Tabs are wider
    } else if (/[a-z0-9]/.test(char)) {
      relWidth = 1.0; // Lowercase letters and digits
    } else if (/[A-Z]/.test(char)) {
      relWidth = 1.2; // Uppercase letters slightly wider
    } else if (/[\u4e00-\u9fff]/.test(char)) {
      relWidth = 2.0; // CJK characters are typically wider
    } else if (/[iIl1|!;:.,']/.test(char)) {
      relWidth = 0.4; // Thin characters
    } else if (/[mMwW@]/.test(char)) {
      relWidth = 1.5; // Wide characters
    }
    
    relativeWidths.push(relWidth);
    totalRelativeWidth += relWidth;
  }
  
  // Convert relative widths to actual pixel widths
  const actualWidths: number[] = [];
  for (const relWidth of relativeWidths) {
    actualWidths.push((relWidth / totalRelativeWidth) * totalWidth);
  }
  
  return actualWidths;
}

/**
 * Get bbox for a character range in the block
 */
export function getBBoxForRange(
  charMap: CharacterMap,
  startChar: number,
  endChar: number
): BBox | null {
  if (startChar < 0 || endChar > charMap.totalChars || startChar >= endChar) {
    return null;
  }
  
  const positions = charMap.positions.slice(startChar, endChar);
  if (positions.length === 0) return null;
  
  // Merge all bboxes in range
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  
  for (const pos of positions) {
    const [x0, y0, x1, y1] = pos.bbox;
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  }
  
  return [minX, minY, maxX, maxY];
}

/**
 * Split bbox by lines (for multi-line ranges)
 */
export function splitBBoxByLines(
  charMap: CharacterMap,
  startChar: number,
  endChar: number,
  lineThreshold: number = 5  // Y-axis threshold for detecting new lines
): BBox[] {
  if (startChar < 0 || endChar > charMap.totalChars || startChar >= endChar) {
    return [];
  }
  
  const positions = charMap.positions.slice(startChar, endChar);
  if (positions.length === 0) return [];
  
  const lines: CharPosition[][] = [];
  let currentLine: CharPosition[] = [positions[0]!];
  
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1]!;
    const curr = positions[i]!;
    
    // Check if same line (similar Y coordinate)
    const prevY = (prev.bbox[1] + prev.bbox[3]) / 2;
    const currY = (curr.bbox[1] + curr.bbox[3]) / 2;
    
    if (Math.abs(currY - prevY) < lineThreshold) {
      currentLine.push(curr);
    } else {
      lines.push(currentLine);
      currentLine = [curr];
    }
  }
  lines.push(currentLine);
  
  // Merge bbox for each line
  const bboxes: BBox[] = [];
  for (const line of lines) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    for (const pos of line) {
      const [x0, y0, x1, y1] = pos.bbox;
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);
    }
    
    bboxes.push([minX, minY, maxX, maxY]);
  }
  
  return bboxes;
}

/**
 * Find text position in character map
 * Returns start and end character indices
 */
export function findTextInCharMap(
  charMap: CharacterMap,
  searchText: string,
  startFrom: number = 0
): { start: number; end: number } | null {
  const blockText = charMap.positions.map(p => p.char).join('');
  const index = blockText.indexOf(searchText, startFrom);
  
  if (index === -1) return null;
  
  return {
    start: index,
    end: index + searchText.length,
  };
}
