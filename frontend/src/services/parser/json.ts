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
      const blockText = extractBlockText(para);
      if (blockText) {
        const blockRef: BlockReference = {
          blockIdx: para.index || 0,
          pageIdx: (para.page || 1) - 1, // Convert 1-indexed to 0-indexed
          bbox: para.bbox || [0, 0, 0, 0],
          pageSize: [612, 792], // Default page size
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

    console.log(`Parsed ${paragraphs.length} paragraphs from normalized format`);
    return mergeCrossPageParagraphs(paragraphs);
  }

  // Fall back to raw MinerU format (pdf_info)
  const pages: PageInfo[] = json.pdf_info || [];
  const paragraphs: Paragraph[] = [];

  for (const page of pages) {
    const pageIdx = page.page_idx;
    const pageSize = page.page_size || [612, 792];
    const blocks = page.para_blocks || [];

    for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
      const block = blocks[blockIdx]!;
      const blockText = extractBlockText(block);

      // Create block reference for visual annotation
      const blockRef: BlockReference = {
        blockIdx,
        pageIdx,
        bbox: block.bbox || [0, 0, 0, 0],
        pageSize: pageSize as [number, number],
        text: blockText.trim(),
      };

      // Handle nested blocks (like lists)
      if (block.blocks) {
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
