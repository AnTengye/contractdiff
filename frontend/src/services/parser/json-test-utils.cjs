
// Utils extracted from json.ts for testing
function endsWithCompleteSentence(text) {
  if (!text) return true;
  const trimmed = text.trim();
  const sentenceEndingPunctuation = /[。！？.!?；;：:]$/;
  return sentenceEndingPunctuation.test(trimmed);
}

function startsWithSectionNumber(text) {
  if (!text) return false;
  const trimmed = text.trim();

  const patterns = [
    /^\d+(?:\.\d+)*[.、）)]\s*/,
    /^[（(]?[一二三四五六七八九十]+[）)、]\s*/,
    /^第[一二三四五六七八九十\d]+[条章节款项]\s*/,
    /^[（(]\d+[）)]\s*/,
    /^[a-zA-Z][.）)]\s*/,
  ];

  return patterns.some(pattern => pattern.test(trimmed));
}

function shouldMergeParagraphs(prevParagraph, currentParagraph) {
  if (!prevParagraph || !currentParagraph) return false;
  if (endsWithCompleteSentence(prevParagraph.text)) return false;
  if (startsWithSectionNumber(currentParagraph.text)) return false;
  return true;
}

function mergeCrossPageParagraphs(paragraphs) {
  if (paragraphs.length <= 1) return paragraphs;

  const merged = [];
  let i = 0;

  while (i < paragraphs.length) {
    const current = { ...paragraphs[i] };
    current.sourceBlocks = current.sourceBlocks ? [...current.sourceBlocks] : [];

    while (
      i + 1 < paragraphs.length &&
      shouldMergeParagraphs(current, paragraphs[i + 1])
    ) {
      const next = paragraphs[i + 1];
      current.text = current.text + next.text;
      if (next.sourceBlocks) {
        current.sourceBlocks.push(...next.sourceBlocks);
      }
      i++;
    }

    merged.push(current);
    i++;
  }

  return merged;
}

module.exports = {
  shouldMergeParagraphs,
  mergeCrossPageParagraphs
};
