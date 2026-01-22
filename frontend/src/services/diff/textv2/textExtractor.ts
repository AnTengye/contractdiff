// Text extractor - extracts all text content from contract data
// and maintains position mapping for later rendering

import type {
  ContractData,
  Block,
  TextSegment,
} from './types';

// Default page size (A4 at 72 DPI) - used when page_size is not available
const DEFAULT_PAGE_SIZE: [number, number] = [595, 842];

/**
 * Extract all text from a contract document
 * Returns concatenated text and segment mapping for position tracking
 */
export function extractText(data: ContractData): {
  fullText: string;
  segments: TextSegment[];
} {
  const segments: TextSegment[] = [];
  let currentOffset = 0;

  // Build page size map from pdf_info if available
  const pageSizeMap = buildPageSizeMap(data);

  // Handle normalized format (paragraphs array)
  if (data.paragraphs && Array.isArray(data.paragraphs)) {
    console.log('[TextExtractor] Using normalized format, blocks:', data.paragraphs.length);
    
    for (let blockIdx = 0; blockIdx < data.paragraphs.length; blockIdx++) {
      const block = data.paragraphs[blockIdx]!;
      const pageIdx = (block.page || 1) - 1; // Convert to 0-indexed
      const pageSize = pageSizeMap.get(pageIdx) || DEFAULT_PAGE_SIZE;
      
      const extracted = extractBlockSegments(block, pageIdx, blockIdx, currentOffset, pageSize);
      segments.push(...extracted.segments);
      currentOffset = extracted.nextOffset;
    }
  }
  
  // Handle raw MinerU format (pdf_info)
  else if (data.pdf_info && Array.isArray(data.pdf_info)) {
    console.log('[TextExtractor] Using pdf_info format, pages:', data.pdf_info.length);
    
    // Sort pages by page_idx to ensure correct order
    const sortedPages = [...data.pdf_info].sort((a, b) => a.page_idx - b.page_idx);
    
    let globalBlockIdx = 0;
    
    for (const page of sortedPages) {
      const pageIdx = page.page_idx;
      const pageSize = (page.page_size || DEFAULT_PAGE_SIZE) as [number, number];
      const blocks = page.para_blocks || [];
      
      for (const block of blocks) {
        const extracted = extractBlockSegments(
          block, 
          pageIdx, 
          globalBlockIdx, 
          currentOffset,
          pageSize
        );
        segments.push(...extracted.segments);
        currentOffset = extracted.nextOffset;
        globalBlockIdx++;
      }
    }
  }
  
  // Concatenate all text
  const fullText = segments.map(s => s.text).join('');
  
  console.log(`[TextExtractor] Extracted ${segments.length} segments, total chars: ${fullText.length}`);
  
  return { fullText, segments };
}

/**
 * Build a map of page index to page size from pdf_info
 */
function buildPageSizeMap(data: ContractData): Map<number, [number, number]> {
  const map = new Map<number, [number, number]>();
  
  if (data.pdf_info && Array.isArray(data.pdf_info)) {
    for (const page of data.pdf_info) {
      if (page.page_size) {
        map.set(page.page_idx, page.page_size as [number, number]);
      }
    }
  }
  
  const metadata = (data as any).metadata;
  if (metadata?.page_sizes && Array.isArray(metadata.page_sizes)) {
    for (const ps of metadata.page_sizes) {
      if (ps.width && ps.height) {
        map.set(ps.page_idx, [ps.width, ps.height] as [number, number]);
      }
    }
  }
  
  return map;
}

/**
 * Extract text segments from a single block
 */
const IGNORED_BLOCK_TYPES = new Set(['header', 'footer', 'page_header', 'page_footer', 'page_number']);

function extractBlockSegments(
  block: Block,
  pageIdx: number,
  blockIdx: number,
  startOffset: number,
  pageSize?: [number, number]
): { segments: TextSegment[]; nextOffset: number } {
  const segments: TextSegment[] = [];
  let currentOffset = startOffset;
  
  if (block.type && IGNORED_BLOCK_TYPES.has(block.type)) {
    return { segments, nextOffset: currentOffset };
  }
  
  // Handle nested blocks first (like lists)
  if (block.blocks && block.blocks.length > 0) {
    for (const subBlock of block.blocks) {
      const extracted = extractBlockSegments(
        subBlock,
        pageIdx,
        blockIdx,
        currentOffset,
        pageSize
      );
      segments.push(...extracted.segments);
      currentOffset = extracted.nextOffset;
    }
    return { segments, nextOffset: currentOffset };
  }
  
  // Handle lines/spans structure (MinerU format)
  if (block.lines && block.lines.length > 0) {
    for (let lineIdx = 0; lineIdx < block.lines.length; lineIdx++) {
      const line = block.lines[lineIdx]!;
      const spans = line.spans || [];
      
      for (let spanIdx = 0; spanIdx < spans.length; spanIdx++) {
        const span = spans[spanIdx]!;
        const content = span.content || '';
        
        if (content) {
          segments.push({
            text: content,
            pageIdx,
            blockIdx,
            lineIdx,
            spanIdx,
            bbox: span.bbox || block.bbox,
            pageSize,
            startOffset: currentOffset,
            endOffset: currentOffset + content.length,
          });
          currentOffset += content.length;
        }
      }
    }
  }
  // Handle direct text field (PaddleOCR format)
  else if (block.text) {
    const content = block.text;
    segments.push({
      text: content,
      pageIdx,
      blockIdx,
      lineIdx: 0,
      spanIdx: 0,
      bbox: block.bbox,
      pageSize,
      startOffset: currentOffset,
      endOffset: currentOffset + content.length,
    });
    currentOffset += content.length;
  }
  
  return { segments, nextOffset: currentOffset };
}

/**
 * Find the segment that contains a given character offset
 */
export function findSegmentAtOffset(
  segments: TextSegment[],
  offset: number
): TextSegment | null {
  for (const segment of segments) {
    if (offset >= segment.startOffset && offset < segment.endOffset) {
      return segment;
    }
  }
  return null;
}

/**
 * Find all segments that overlap with a given offset range
 */
export function findSegmentsInRange(
  segments: TextSegment[],
  startOffset: number,
  endOffset: number
): TextSegment[] {
  return segments.filter(segment => 
    segment.startOffset < endOffset && segment.endOffset > startOffset
  );
}

/**
 * Get the bbox for a character range within segments
 * Returns the union of all overlapping segment bboxes
 */
export function getBboxForRange(
  segments: TextSegment[],
  startOffset: number,
  endOffset: number
): { bbox: [number, number, number, number]; pageIdx: number } | null {
  const overlapping = findSegmentsInRange(segments, startOffset, endOffset);
  
  if (overlapping.length === 0) {
    return null;
  }
  
  // Use the first segment's page
  const pageIdx = overlapping[0]!.pageIdx;
  
  // Compute union bbox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  for (const segment of overlapping) {
    if (segment.bbox) {
      const [x0, y0, x1, y1] = segment.bbox;
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);
    }
  }
  
  if (minX === Infinity) {
    return null;
  }
  
  return {
    bbox: [minX, minY, maxX, maxY],
    pageIdx,
  };
}
