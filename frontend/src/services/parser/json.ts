// JSON parsing functions for contract data
import type { ContractData, Paragraph, Block, PageInfo, BlockReference } from '@/types';

/**
 * Check if text ends with a complete sentence (ends with period, question mark, etc.)
 */
export function endsWithCompleteSentence(text: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  const sentenceEndingPunctuation = /[。！？.!?；;：:]$/;
  return sentenceEndingPunctuation.test(trimmed);
}

/**
 * Check if text starts with a section number (e.g., 1., 1.1, （一）, 第一条)
 */
export function startsWithSectionNumber(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();

  const patterns = [
    // Arabic numerals: 1. 1.1 1.1.1 1、 1）
    /^\d+(?:\.\d+)*[.、）)]\s*/,
    // Chinese numerals: 一、 （一） 第一条 第一章
    /^[（(]?[一二三四五六七八九十]+[）)、]\s*/,
    /^第[一二三四五六七八九十\d]+[条章节款项]\s*/,
    // Parenthesized Arabic numerals: (1) （1）
    /^[（(]\d+[）)]\s*/,
    // Letter sequences: a. A. a) A)
    /^[a-zA-Z][.）)]\s*/,
  ];

  return patterns.some(pattern => pattern.test(trimmed));
}

/**
 * Determine if the previous paragraph should be merged with the current one
 */
export function shouldMergeParagraphs(
  prevParagraph: Paragraph | null,
  currentParagraph: Paragraph | null
): boolean {
  if (!prevParagraph || !currentParagraph) return false;

  // Condition 1: Previous paragraph doesn't end with sentence-ending punctuation
  if (endsWithCompleteSentence(prevParagraph.text)) return false;

  // Condition 2: Current paragraph doesn't start with a section number
  if (startsWithSectionNumber(currentParagraph.text)) return false;

  // Cross-page or same-page continuation
  return true;
}

/**
 * Merge paragraphs that should be connected (preserving block references)
 */
export function mergeCrossPageParagraphs(paragraphs: Paragraph[]): Paragraph[] {
  if (paragraphs.length <= 1) return paragraphs;

  const merged: Paragraph[] = [];
  let i = 0;

  while (i < paragraphs.length) {
    const current = { ...paragraphs[i]! };
    // Copy sourceBlocks array to avoid mutation
    current.sourceBlocks = current.sourceBlocks ? [...current.sourceBlocks] : [];

    // Check if we should merge with subsequent paragraphs
    while (
      i + 1 < paragraphs.length &&
      shouldMergeParagraphs(current, paragraphs[i + 1]!)
    ) {
      const next = paragraphs[i + 1]!;
      current.text = current.text + next.text;
      // Merge block references from the next paragraph
      if (next.sourceBlocks) {
        // Ensure sourceBlocks is initialized
        if (!current.sourceBlocks) {
          current.sourceBlocks = [];
        }
        current.sourceBlocks.push(...next.sourceBlocks);
      }
      i++;
    }


    merged.push(current);
    i++;
  }

  console.log(`Paragraph merge: ${paragraphs.length} -> ${merged.length} paragraphs`);
  return merged;
}

/**
 * Extract text from a block, handling nested structures
 */
function extractBlockText(block: Block): string {
  let text = '';

  // Handle normal lines
  if (block.lines) {
    for (const line of block.lines) {
      for (const span of line.spans || []) {
        if (span.content) {
          text += span.content;
        }
      }
    }
  }

  return text;
}

/**
 * Parse contract JSON and extract paragraphs
 * Handles both raw MinerU format (pdf_info) and normalized format (paragraphs array)
 */
export function parseContractJSON(json: ContractData): Paragraph[] {
  // First try normalized format (paragraphs array directly in json_data)
  if (json.paragraphs && Array.isArray(json.paragraphs)) {
    const paragraphs: Paragraph[] = [];

    for (const para of json.paragraphs as Block[]) {
      // Handle nested blocks first
      if (para.blocks && para.blocks.length > 0) {
        for (const subBlock of para.blocks) {
          const subText = extractBlockText(subBlock);
          if (subText) {
            const blockRef: BlockReference = {
              blockIdx: subBlock.index || para.index || 0,
              pageIdx: (para.page || 1) - 1,
              bbox: subBlock.bbox || para.bbox || [0, 0, 0, 0],
              pageSize: [612, 792],
              text: subText.trim(),
            };

            paragraphs.push({
              text: subText.trim(),
              type: subBlock.type || para.type,
              pageIdx: (para.page || 1) - 1,
              sourceBlocks: [blockRef],
            });
          }
        }
      } else {
        const blockText = extractBlockText(para);
        if (blockText) {
          const blockRef: BlockReference = {
            blockIdx: para.index || 0,
            pageIdx: (para.page || 1) - 1,
            bbox: para.bbox || [0, 0, 0, 0],
            pageSize: [612, 792],
            text: blockText.trim(),
          };

          paragraphs.push({
            text: blockText.trim(),
            type: para.type,
            pageIdx: (para.page || 1) - 1,
            sourceBlocks: [blockRef],
          });
        }
      }
    }


    console.log(`Parsed ${paragraphs.length} paragraphs from normalized format`);
    return mergeCrossPageParagraphs(paragraphs);
  }

  // Handle raw MinerU format (pdf_info)
  const pages: PageInfo[] = json.pdf_info || [];
  const paragraphs: Paragraph[] = [];
  const allBlocks: { block: Block; pageIdx: number }[] = [];

  // Step 1: Flatten all blocks across all pages into a single array
  // This ensures that even if page data is slightly out of order, we process it sequentially by page
  for (const page of pages) {
    const pageIdx = page.page_idx;
    const blocks = page.para_blocks || [];
    for (const block of blocks) {
      allBlocks.push({ block, pageIdx });
    }
  }

  // Step 2: Sort all blocks by page index and then by block index (if available) or their natural order
  // This defends against API returning pages or blocks out of order
  allBlocks.sort((a, b) => {
    if (a.pageIdx !== b.pageIdx) return a.pageIdx - b.pageIdx;
    // If blocks have explicit index, use it. Otherwise rely on stable sort/original order
    if (a.block.index !== undefined && b.block.index !== undefined) {
      return a.block.index - b.block.index;
    }
    return 0; 
  });

  // Step 3: Process sorted blocks
  for (const { block, pageIdx } of allBlocks) {
    // Find corresponding page info for page size
    const pageInfo = pages.find(p => p.page_idx === pageIdx);
    const pageSize = pageInfo?.page_size || [612, 792];

    const blockText = extractBlockText(block);

    // Create block reference for visual annotation
    const blockRef: BlockReference = {
      blockIdx: block.index || 0, // Use 0 if index is missing
      pageIdx,
      bbox: block.bbox || [0, 0, 0, 0],
      pageSize: pageSize as [number, number],
      text: blockText.trim(),
    };

    // Handle nested blocks (like lists)
    if (block.blocks && block.blocks.length > 0) {
      for (const subBlock of block.blocks) {
        const subText = extractBlockText(subBlock);
        if (subText) {
          // For nested blocks, use parent block's bbox as reference
          paragraphs.push({
            text: subText.trim(),
            type: subBlock.type || block.type,
            pageIdx: pageIdx,
            sourceBlocks: [blockRef],
          });
        }
      }
    } else if (blockText) {
      paragraphs.push({
        text: blockText.trim(),
        type: block.type,
        pageIdx: pageIdx,
        sourceBlocks: [blockRef],
      });
    }
  }


  // Merge cross-page split paragraphs
  return mergeCrossPageParagraphs(paragraphs);
}

/**
 * Convert paragraphs array to plain text
 */
export function paragraphsToText(paragraphs: Paragraph[]): string {
  return paragraphs.map(p => p.text).join('\n');
}
