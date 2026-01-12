// Unified diff engine - orchestrates both text and visual comparison

import type { ContractData } from '@/types';
import type { TextBlock } from '../text/types';
import type { VisualBlock } from '../visual/types';
import { computeTextDiff, exportTextDiffDebug } from '../text';
import { computeVisualDiff, exportVisualDiffDebug } from '../visual';

/**
 * Parse contract data and extract blocks with visual information
 */
export function parseVisualBlocks(data: ContractData): VisualBlock[] {
  const blocks: VisualBlock[] = [];
  
  console.log('[Parser] Input data type:', typeof data);
  console.log('[Parser] Has paragraphs:', !!data.paragraphs);
  console.log('[Parser] Has pdf_info:', !!data.pdf_info);
  
  // Handle normalized format (paragraphs array)
  if (data.paragraphs && Array.isArray(data.paragraphs)) {
    console.log('[Parser] Using normalized format, paragraphs count:', data.paragraphs.length);
    
    for (const para of data.paragraphs) {
      const text = extractBlockText(para);
      
      // Don't skip any blocks, but handle empty ones based on type
      let displayText = text.trim();
      
      // Only show type indicator for truly non-text elements (table, image)
      if (!displayText) {
        const ptype = para.type || 'unknown';
        // Only show indicators for elements that can't have text
        if (ptype === 'table') {
          displayText = '[表格]';
        } else if (ptype === 'image' || ptype === 'figure') {
          displayText = '[图片]';
        } else {
          // For text and list types with no content, use empty string
          // This will still create a block but won't show misleading [list] tags
          displayText = '';
        }
      }
      
      blocks.push({
        index: para.index || blocks.length,
        text: displayText,
        pageIdx: (para.page || 1) - 1,
        type: para.type,
        bbox: para.bbox || [0, 0, 0, 0],
        pageSize: [612, 792],
        lines: extractLines(para),
        raw: para,
      });
    }
    
    // CRITICAL FIX: Sort blocks by page and index to ensure correct order
    // This fixes the issue where backend data might be in wrong order
    blocks.sort((a, b) => {
      if (a.pageIdx !== b.pageIdx) {
        return a.pageIdx - b.pageIdx;
      }
      return a.index - b.index;
    });
    
    console.log('[Parser] Sorted blocks by page and index order');
    console.log('[Parser] Extracted', blocks.length, 'blocks from paragraphs');
  }
  
  // Handle raw MinerU format (pdf_info)
  if (data.pdf_info && Array.isArray(data.pdf_info)) {
    console.log('[Parser] Using pdf_info format, pages count:', data.pdf_info.length);
    
    for (const page of data.pdf_info) {
      const pageIdx = page.page_idx;
      const pageSize = page.page_size || [612, 792];
      const paraBlocks = page.para_blocks || [];
      
      for (let i = 0; i < paraBlocks.length; i++) {
        const block = paraBlocks[i]!;
        const text = extractBlockText(block);
        
        // Only show type indicator for non-text elements
        let displayText = text.trim();
        
        if (!displayText) {
          const btype = block.type || 'unknown';
          if (btype === 'table') {
            displayText = '[表格]';
          } else if (btype === 'image' || btype === 'figure') {
            displayText = '[图片]';
          } else {
            displayText = '';
          }
        }
        
        blocks.push({
          index: blocks.length,
          text: displayText,
          pageIdx,
          type: block.type,
          bbox: block.bbox || [0, 0, 0, 0],
          pageSize: pageSize as [number, number],
          lines: extractLines(block),
          raw: block,
        });
      }
    }
    
    console.log('[Parser] Extracted', blocks.length, 'blocks from pdf_info');
    
    // CRITICAL FIX: Sort blocks by page and index for pdf_info format too
    blocks.sort((a, b) => {
      if (a.pageIdx !== b.pageIdx) {
        return a.pageIdx - b.pageIdx;
      }
      return a.index - b.index;
    });
    
    console.log('[Parser] Sorted blocks by page and index order');
  }
  
  if (blocks.length === 0) {
    console.warn('[Parser] No blocks extracted! Data structure may not match expected format.');
    console.log('[Parser] Sample data:', JSON.stringify(data).substring(0, 1000));
  }
  
  console.log(`[Parser] Extracted ${blocks.length} visual blocks`);
  return blocks;
}

/**
 * Extract text from a block
 */
function extractBlockText(block: any): string {
  let text = '';
  
  // Check if block has text property directly
  if (block.text && typeof block.text === 'string') {
    return block.text;
  }
  
  // Handle nested blocks (like list items)
  if (block.blocks && Array.isArray(block.blocks)) {
    for (const subBlock of block.blocks) {
      const subText = extractBlockText(subBlock);
      if (subText) {
        text += subText + '\n';
      }
    }
  }
  
  // Handle lines/spans structure
  if (block.lines && Array.isArray(block.lines)) {
    for (const line of block.lines) {
      if (line.spans && Array.isArray(line.spans)) {
        for (const span of line.spans) {
          if (span.content) {
            text += span.content;
          }
        }
      }
    }
  }
  
  return text;
}

/**
 * Extract lines with spans from a block
 */
function extractLines(block: any): any[] {
  if (!block.lines || !Array.isArray(block.lines)) {
    // Fallback: create a single line/span from the whole block
    const text = extractBlockText(block);
    if (!text) return [];
    
    return [{
      spans: [{
        content: text,
        bbox: block.bbox || [0, 0, 0, 0],
      }],
      bbox: block.bbox || [0, 0, 0, 0],
    }];
  }
  
  return block.lines.map((line: any) => ({
    spans: (line.spans || []).map((span: any) => ({
      content: span.content || '',
      bbox: span.bbox || [0, 0, 0, 0],
      fontName: span.font_name,
      fontSize: span.font_size,
    })),
    bbox: line.bbox || [0, 0, 0, 0],
  }));
}

/**
 * Convert VisualBlock to TextBlock (for text-only comparison)
 */
export function toTextBlocks(visualBlocks: VisualBlock[]): TextBlock[] {
  return visualBlocks.map(vb => ({
    index: vb.index,
    text: vb.text,
    pageIdx: vb.pageIdx,
    type: vb.type,
    raw: vb.raw,
  }));
}

/**
 * Complete comparison result
 */
export interface ComparisonResult {
  textDiff: ReturnType<typeof computeTextDiff>;
  visualDiff: ReturnType<typeof computeVisualDiff>;
}

/**
 * Run complete comparison (text + visual)
 */
export function runComparison(
  leftData: ContractData,
  rightData: ContractData,
  options: {
    mergeAnnotations?: boolean;
    debug?: boolean;
    enableOCRNormalization?: boolean;
    similarityThreshold?: number;
    usePositionScoring?: boolean;
  } = {}
): ComparisonResult {
  console.log('[Engine] Starting comparison...');
  console.log('[Engine] Left data keys:', Object.keys(leftData));
  console.log('[Engine] Right data keys:', Object.keys(rightData));
  
  if (options.enableOCRNormalization) {
    console.log('[Engine] OCR normalization enabled - ignoring punctuation/whitespace/checkbox differences');
  }
  
  if (options.usePositionScoring) {
    console.log('[Engine] Position-aware scoring enabled for better block alignment');
  }
  
  // Parse visual blocks
  const leftVisualBlocks = parseVisualBlocks(leftData);
  const rightVisualBlocks = parseVisualBlocks(rightData);
  
  console.log('[Engine] Left visual blocks:', leftVisualBlocks.length);
  console.log('[Engine] Right visual blocks:', rightVisualBlocks.length);
  
  if (leftVisualBlocks.length === 0 || rightVisualBlocks.length === 0) {
    console.error('[Engine] No blocks extracted! Check data format.');
    console.log('[Engine] Sample left data:', JSON.stringify(leftData).substring(0, 500));
    console.log('[Engine] Sample right data:', JSON.stringify(rightData).substring(0, 500));
  }
  
  // Convert to text blocks
  const leftTextBlocks = toTextBlocks(leftVisualBlocks);
  const rightTextBlocks = toTextBlocks(rightVisualBlocks);
  
  // Step 1: Text comparison with optional OCR normalization and alignment options
  console.log('[Engine] Running text comparison...');
  const textDiff = computeTextDiff(leftTextBlocks, rightTextBlocks, {
    enableOCRNormalization: options.enableOCRNormalization,
    alignmentOptions: {
      threshold: options.similarityThreshold,
      usePositionScoring: options.usePositionScoring,
    },
  });
  
  if (options.debug) {
    console.log(exportTextDiffDebug(textDiff));
  }
  
  // Step 2: Visual comparison
  console.log('[Engine] Running visual comparison...');
  const visualDiff = computeVisualDiff(
    textDiff.diffs,
    leftVisualBlocks,
    rightVisualBlocks,
    { mergeAnnotations: options.mergeAnnotations }
  );
  
  if (options.debug) {
    console.log(exportVisualDiffDebug(visualDiff));
  }
  
  console.log('[Engine] Comparison complete');
  
  return {
    textDiff,
    visualDiff,
  };
}

/**
 * Export comparison results for debugging
 */
export function exportComparisonDebug(result: ComparisonResult): string {
  const lines: string[] = [];
  
  lines.push('=' .repeat(60));
  lines.push('COMPARISON RESULTS');
  lines.push('=' .repeat(60));
  lines.push('');
  
  lines.push(exportTextDiffDebug(result.textDiff));
  lines.push('');
  lines.push('=' .repeat(60));
  lines.push('');
  lines.push(exportVisualDiffDebug(result.visualDiff));
  
  return lines.join('\n');
}
