// Text normalization functions

/**
 * Normalize text for comparison (ignore whitespace and punctuation differences)
 */
export function normalizeText(text: string): string {
  if (!text) return '';

  return text
    // Remove all whitespace
    .replace(/\s+/g, '')
    // Normalize Chinese/English punctuation
    .replace(/[，,]/g, ',')
    .replace(/[。.]/g, '.')
    .replace(/[：:]/g, ':')
    .replace(/[；;]/g, ';')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/[""''「」『』]/g, '"')
    .replace(/[【\[]/g, '[')
    .replace(/[】\]]/g, ']')
    .replace(/[—–－-]/g, '-')
    .replace(/[·•‧]/g, '.')
    .replace(/[～~]/g, '~')
    .replace(/[／/]/g, '/')
    .replace(/[？?]/g, '?')
    .replace(/[！!]/g, '!')
    // Remove zero-width and nbsp characters
    .replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, '')
    .toLowerCase();
}

/**
 * Extract section number from paragraph text
 */
export function extractSectionNumber(text: string): string | null {
  if (!text) return null;

  const trimmed = text.trim();

  const patterns: RegExp[] = [
    // Arabic numerals: 1. 1.1 1.1.1 1、 1）
    /^(\d+(?:\.\d+)*)[.、）)]\s*/,
    // Chinese numerals: 一、 （一）
    /^[（(]?([一二三四五六七八九十]+)[）)、]\s*/,
    // 第X条/章/节
    /^第([一二三四五六七八九十\d]+)[条章节款项]\s*/,
    // Parenthesized Arabic numerals: (1) （1）
    /^[（(](\d+)[）)]\s*/,
    // Letter sequences: a. A. a) A)
    /^([a-zA-Z])[.）)]\s*/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Normalize section number (convert Chinese numerals to Arabic)
 */
export function normalizeNumber(num: string): string {
  if (!num) return '';

  const chineseNums: Record<string, string> = {
    '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
    '六': '6', '七': '7', '八': '8', '九': '9', '十': '10',
    '十一': '11', '十二': '12', '十三': '13', '十四': '14', '十五': '15',
  };

  if (chineseNums[num]) {
    return chineseNums[num]!;
  }

  return num.toLowerCase();
}
