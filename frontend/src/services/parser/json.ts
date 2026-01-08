// JSON parsing functions for contract data
import type { ContractData, Paragraph, Block, PageInfo } from '@/types';

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
 * Merge paragraphs that should be connected
 */
export function mergeCrossPageParagraphs(paragraphs: Paragraph[]): Paragraph[] {
  if (paragraphs.length <= 1) return paragraphs;

  const merged: Paragraph[] = [];
  let i = 0;

  while (i < paragraphs.length) {
    const current = { ...paragraphs[i]! };

    // Check if we should merge with subsequent paragraphs
    while (
      i + 1 < paragraphs.length &&
      shouldMergeParagraphs(current, paragraphs[i + 1]!)
    ) {
      current.text = current.text + paragraphs[i + 1]!.text;
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
 */
export function parseContractJSON(json: ContractData): Paragraph[] {
  const pages: PageInfo[] = json.pdf_info || [];
  const paragraphs: Paragraph[] = [];

  for (const page of pages) {
    const pageIdx = page.page_idx;
    const blocks = page.para_blocks || [];

    for (const block of blocks) {
      let blockText = extractBlockText(block);

      // Handle nested blocks (like lists)
      if (block.blocks) {
        for (const subBlock of block.blocks) {
          const subText = extractBlockText(subBlock);
          if (subText) {
            paragraphs.push({
              text: subText.trim(),
              type: subBlock.type || block.type,
              pageIdx: pageIdx,
            });
          }
        }
      } else if (blockText) {
        paragraphs.push({
          text: blockText.trim(),
          type: block.type,
          pageIdx: pageIdx,
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
