// DOCX document service
import mammoth from 'mammoth';

export interface DocxResult {
  html: string;
  messages: { type: string; message: string }[];
}

/**
 * Load and convert DOCX to HTML
 */
export async function loadDocxFromUrl(url: string): Promise<DocxResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch DOCX: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return convertDocxToHtml(arrayBuffer);
}

/**
 * Convert DOCX ArrayBuffer to HTML
 */
export async function convertDocxToHtml(arrayBuffer: ArrayBuffer): Promise<DocxResult> {
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
      ],
    }
  );

  return {
    html: result.value,
    messages: result.messages,
  };
}

/**
 * Add paragraph markers to DOCX HTML for diff highlighting
 */
export function addDocxParagraphMarkers(container: HTMLElement): void {
  const paragraphs = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
  paragraphs.forEach((p, idx) => {
    p.setAttribute('data-para-idx', String(idx));
  });
}

/**
 * Build text node map for highlighting
 */
export function buildTextNodeMap(
  container: HTMLElement
): Map<string, { node: Text; start: number; end: number }[]> {
  const map = new Map<string, { node: Text; start: number; end: number }[]>();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent || '';
    if (!text.trim()) continue;

    // Normalize and index
    const normalized = text.toLowerCase().replace(/\s+/g, '');
    if (!map.has(normalized)) {
      map.set(normalized, []);
    }
    map.get(normalized)!.push({
      node,
      start: 0,
      end: text.length,
    });
  }

  return map;
}

/**
 * Highlight text in element
 */
export function highlightTextInElement(
  container: HTMLElement,
  searchText: string,
  className: string
): boolean {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const normalizedSearch = searchText.toLowerCase().replace(/\s+/g, '');
  let found = false;

  const nodesToProcess: { node: Text; matches: { start: number; end: number }[] }[] = [];

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent || '';
    const normalizedText = text.toLowerCase().replace(/\s+/g, '');

    if (normalizedText.includes(normalizedSearch)) {
      // Find position in original text
      const lowerText = text.toLowerCase();
      const searchLower = searchText.toLowerCase();
      let pos = 0;
      const matches: { start: number; end: number }[] = [];

      while ((pos = lowerText.indexOf(searchLower, pos)) !== -1) {
        matches.push({ start: pos, end: pos + searchText.length });
        pos += searchText.length;
      }

      if (matches.length > 0) {
        nodesToProcess.push({ node, matches });
        found = true;
      }
    }
  }

  // Process nodes in reverse to maintain positions
  for (const { node, matches } of nodesToProcess.reverse()) {
    for (const { start, end } of matches.reverse()) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, Math.min(end, node.textContent?.length || 0));

      const span = document.createElement('span');
      span.className = className;
      range.surroundContents(span);
    }
  }

  return found;
}
