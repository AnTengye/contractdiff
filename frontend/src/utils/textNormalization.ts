// Text normalization utilities for OCR-parsed documents
// Handles common OCR artifacts and insignificant differences

export interface NormalizationOptions {
  // Whitespace normalization
  normalizeWhitespace?: boolean;          // Collapse multiple spaces to one
  trimWhitespace?: boolean;               // Trim leading/trailing spaces
  
  // Punctuation normalization
  normalizePunctuation?: boolean;         // Normalize similar punctuation
  ignoreCheckboxes?: boolean;             // Ignore checkbox characters (☑️✓✔︎□☐)
  
  // Character normalization
  normalizeQuotes?: boolean;              // Convert all quotes to standard "
  normalizeFullwidth?: boolean;           // Convert fullwidth chars to halfwidth
  normalizeDashes?: boolean;              // Normalize different dash types
  
  // Case normalization
  caseSensitive?: boolean;                // Whether to preserve case
  
  // Special characters
  removeInvisibleChars?: boolean;         // Remove zero-width spaces, etc.
  normalizeNumberFormats?: boolean;       // Normalize number separators
  
  // Aggressive Normalization (match legacy behavior)
  stripAllWhitespace?: boolean;           // Remove ALL whitespace (spaces, tabs, newlines)
}

export const DEFAULT_NORMALIZATION_OPTIONS: NormalizationOptions = {
  normalizeWhitespace: true,
  trimWhitespace: true,
  normalizePunctuation: true,
  ignoreCheckboxes: true,
  normalizeQuotes: true,
  normalizeFullwidth: true,
  normalizeDashes: true,
  caseSensitive: true,
  removeInvisibleChars: true,
  normalizeNumberFormats: false,
  stripAllWhitespace: false, // Disabled by default, enable for OCR matching
};

/**
 * Normalize text for comparison to ignore OCR artifacts
 */
export function normalizeText(text: string, options: NormalizationOptions = DEFAULT_NORMALIZATION_OPTIONS): string {
  let normalized = text;
  
  // Strip all whitespace (Aggressive Mode)
  if (options.stripAllWhitespace) {
    normalized = normalized.replace(/\s+/g, '');
  }
  
  // Remove invisible characters (zero-width spaces, soft hyphens, etc.)
  if (options.removeInvisibleChars) {
    normalized = removeInvisibleCharacters(normalized);
  }
  
  // Normalize whitespace
  if (options.normalizeWhitespace) {
    normalized = normalizeWhitespace(normalized);
  }
  
  if (options.trimWhitespace) {
    normalized = normalized.trim();
  }
  
  // Normalize punctuation
  if (options.normalizePunctuation) {
    normalized = normalizePunctuation(normalized);
  }
  
  // Ignore checkboxes
  if (options.ignoreCheckboxes) {
    normalized = removeCheckboxCharacters(normalized);
  }
  
  // Normalize quotes
  if (options.normalizeQuotes) {
    normalized = normalizeQuotes(normalized);
  }
  
  // Normalize fullwidth/halfwidth characters
  if (options.normalizeFullwidth) {
    normalized = normalizeFullwidthChars(normalized);
  }
  
  // Normalize dashes
  if (options.normalizeDashes) {
    normalized = normalizeDashes(normalized);
  }
  
  // Case normalization
  if (!options.caseSensitive) {
    normalized = normalized.toLowerCase();
  }
  
  // Normalize number formats
  if (options.normalizeNumberFormats) {
    normalized = normalizeNumberFormats(normalized);
  }
  
  return normalized;
}

/**
 * Remove invisible/control characters
 */
function removeInvisibleCharacters(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width spaces
    .replace(/\u00AD/g, '')                 // Soft hyphen
    .replace(/[\u0000-\u001F]/g, '')        // Control characters
    .replace(/\u00A0/g, ' ');               // Non-breaking space -> normal space
}

/**
 * Normalize whitespace (collapse multiple spaces, normalize line breaks)
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\r\n]+/g, '\n')      // Normalize line breaks
    .replace(/[ \t]+/g, ' ')        // Collapse spaces and tabs
    .replace(/ *\n */g, '\n')       // Remove spaces around line breaks
    .replace(/\n{3,}/g, '\n\n');    // Max 2 consecutive line breaks
}

/**
 * Normalize punctuation marks that are often confused by OCR
 */
function normalizePunctuation(text: string): string {
  return text
    // Commas
    .replace(/[，,]/g, ',')         // Chinese comma -> comma
    // Periods
    .replace(/[。．]/g, '.')         // Chinese/fullwidth period -> period
    // Semicolons
    .replace(/[；]/g, ';')           // Chinese semicolon -> semicolon
    // Colons
    .replace(/[：]/g, ':')           // Chinese colon -> colon
    // Exclamation marks
    .replace(/[！]/g, '!')           // Chinese exclamation -> exclamation
    // Question marks
    .replace(/[？]/g, '?')           // Chinese question mark -> question mark
    // Parentheses
    .replace(/[（]/g, '(')           // Chinese left paren -> left paren
    .replace(/[）]/g, ')')           // Chinese right paren -> right paren
    // Brackets
    .replace(/[【]/g, '[')           // Chinese left bracket -> left bracket
    .replace(/[】]/g, ']');          // Chinese right bracket -> right bracket
}

/**
 * Remove checkbox and check mark characters
 */
function removeCheckboxCharacters(text: string): string {
  return text
    .replace(/[☑☐✓✔︎✗✘]/g, '')     // Checkboxes and check marks
    .replace(/\[x\]/gi, '')         // Text checkboxes [x] or [X]
    .replace(/\[ \]/g, '');         // Empty text checkboxes [ ]
}

/**
 * Normalize quote characters
 */
function normalizeQuotes(text: string): string {
  return text
    // Single quotes
    .replace(/[''‚‛]/g, "'")        // Curly single quotes -> straight quote
    // Double quotes
    .replace(/[""„‟]/g, '"')        // Curly double quotes -> straight quote
    // CJK quotes
    .replace(/[「」『』]/g, '"');    // Japanese quotes -> double quote
}

/**
 * Convert fullwidth characters to halfwidth
 */
function normalizeFullwidthChars(text: string): string {
  let result = '';
  
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    
    // Fullwidth ASCII variants (FF00-FF5E) -> ASCII (0020-007E)
    if (code >= 0xFF01 && code <= 0xFF5E) {
      result += String.fromCharCode(code - 0xFEE0);
    }
    // Fullwidth space (3000) -> normal space
    else if (code === 0x3000) {
      result += ' ';
    }
    else {
      result += text[i];
    }
  }
  
  return result;
}

/**
 * Normalize different types of dashes and hyphens
 */
function normalizeDashes(text: string): string {
  return text
    .replace(/[‐‑‒–—―−]/g, '-')    // Various dashes -> hyphen-minus
    .replace(/[～〜]/g, '~');        // Fullwidth tildes -> tilde
}

/**
 * Normalize number formats (remove separators in numbers)
 * Example: "1,000" -> "1000", "1 000" -> "1000"
 */
function normalizeNumberFormats(text: string): string {
  // Remove thousand separators in numbers
  // Match patterns like: 1,000 or 1 000 or 1,000.50
  return text.replace(/(\d)[\s,](\d{3})/g, '$1$2');
}

/**
 * Check if two texts are semantically equal after normalization
 */
export function areTextsEqual(
  text1: string,
  text2: string,
  options: NormalizationOptions = DEFAULT_NORMALIZATION_OPTIONS
): boolean {
  const normalized1 = normalizeText(text1, options);
  const normalized2 = normalizeText(text2, options);
  return normalized1 === normalized2;
}

/**
 * Calculate similarity ratio between two texts after normalization
 * Returns a value between 0 and 1 (1 = identical)
 */
export function calculateNormalizedSimilarity(
  text1: string,
  text2: string,
  options: NormalizationOptions = DEFAULT_NORMALIZATION_OPTIONS
): number {
  const normalized1 = normalizeText(text1, options);
  const normalized2 = normalizeText(text2, options);
  
  if (normalized1 === normalized2) return 1.0;
  if (normalized1.length === 0 && normalized2.length === 0) return 1.0;
  if (normalized1.length === 0 || normalized2.length === 0) return 0.0;
  
  // Use Levenshtein distance ratio
  const maxLen = Math.max(normalized1.length, normalized2.length);
  const distance = levenshteinDistance(normalized1, normalized2);
  return 1 - (distance / maxLen);
}

/**
 * Simple Levenshtein distance implementation
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  
  const matrix: number[][] = [];
  
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= len2; j++) {
    matrix[0]![j] = j;
  }
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,      // deletion
        matrix[i]![j - 1]! + 1,      // insertion
        matrix[i - 1]![j - 1]! + cost // substitution
      );
    }
  }
  
  return matrix[len1]![len2]!;
}
