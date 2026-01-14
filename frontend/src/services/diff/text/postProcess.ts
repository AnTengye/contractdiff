// Post-processing for paragraph boundary misalignment issues
// Detects content that is incorrectly marked as add/delete due to different paragraph boundaries

import type { CharacterDiff, DiffTuple } from './types';
import { normalizeText } from '@/utils/textNormalization';

/**
 * Options for reconciliation
 */
export interface ReconcileOptions {
    /** Minimum similarity threshold for substring matching (0-1) */
    similarityThreshold?: number;
    /** Whether to log debug info */
    debug?: boolean;
}

const DEFAULT_OPTIONS: ReconcileOptions = {
    similarityThreshold: 0.9,
    debug: false,
};

/**
 * Normalize text for substring matching
 * Removes all whitespace and normalizes punctuation
 */
function normalizeForMatch(text: string): string {
    return normalizeText(text, {
        stripAllWhitespace: true,
        normalizePunctuation: true,
        normalizeQuotes: true,
        normalizeFullwidth: true,
        normalizeDashes: true,
        removeInvisibleChars: true,
    });
}

/**
 * Extract deleted content from a diff
 */
function extractDeletedContent(diff: CharacterDiff): string {
    if (!diff.hasDiff) return '';

    let deleted = '';
    for (const [op, text] of diff.diffs) {
        if (op === -1) {
            deleted += text;
        }
    }
    return deleted;
}

/**
 * Extract inserted content from a diff
 */
function extractInsertedContent(diff: CharacterDiff): string {
    if (!diff.hasDiff) return '';

    let inserted = '';
    for (const [op, text] of diff.diffs) {
        if (op === 1) {
            inserted += text;
        }
    }
    return inserted;
}

/**
 * Check if content A is contained within content B (after normalization)
 */
function isSubstringMatch(contentA: string, contentB: string): boolean {
    if (!contentA || !contentB) return false;

    const normalizedA = normalizeForMatch(contentA);
    const normalizedB = normalizeForMatch(contentB);

    // Check if A is a substring of B or B is a substring of A
    return normalizedB.includes(normalizedA) || normalizedA.includes(normalizedB);
}

/**
 * Check if two normalized texts are essentially equal
 */
function areNormalizedEqual(text1: string, text2: string): boolean {
    const norm1 = normalizeForMatch(text1);
    const norm2 = normalizeForMatch(text2);
    return norm1 === norm2;
}

/**
 * Represents a misaligned content pair
 */
interface MisalignedPair {
    deleteIndex: number;
    insertIndex: number;
    deletedContent: string;
    insertedContent: string;
}

/**
 * Detect misaligned content - content that appears as DELETE in one place
 * but as INSERT in another due to paragraph boundary differences
 */
export function detectMisalignedContent(
    diffs: CharacterDiff[],
    options: ReconcileOptions = DEFAULT_OPTIONS
): MisalignedPair[] {
    const pairs: MisalignedPair[] = [];

    // Collect all deletions and insertions
    const deletions: { index: number; content: string; normalized: string }[] = [];
    const insertions: { index: number; content: string; normalized: string }[] = [];

    for (let i = 0; i < diffs.length; i++) {
        const diff = diffs[i]!;
        if (!diff.hasDiff) continue;

        const deleted = extractDeletedContent(diff);
        const inserted = extractInsertedContent(diff);

        if (deleted.trim()) {
            deletions.push({
                index: i,
                content: deleted,
                normalized: normalizeForMatch(deleted),
            });
        }

        if (inserted.trim()) {
            insertions.push({
                index: i,
                content: inserted,
                normalized: normalizeForMatch(inserted),
            });
        }
    }

    if (options.debug) {
        console.log(`[PostProcess] Found ${deletions.length} deletions and ${insertions.length} insertions`);
    }

    // Find matching pairs
    const usedDeletions = new Set<number>();
    const usedInsertions = new Set<number>();

    for (const del of deletions) {
        if (usedDeletions.has(del.index)) continue;

        for (const ins of insertions) {
            if (usedInsertions.has(ins.index)) continue;
            if (del.index === ins.index) continue; // Same diff block

            // Check if the deleted content is substantially the same as inserted content
            if (areNormalizedEqual(del.content, ins.content) ||
                isSubstringMatch(del.content, ins.content)) {

                if (options.debug) {
                    console.log(`[PostProcess] Found misaligned pair:`);
                    console.log(`  DELETE[${del.index}]: "${del.content.substring(0, 50)}..."`);
                    console.log(`  INSERT[${ins.index}]: "${ins.content.substring(0, 50)}..."`);
                }

                pairs.push({
                    deleteIndex: del.index,
                    insertIndex: ins.index,
                    deletedContent: del.content,
                    insertedContent: ins.content,
                });

                usedDeletions.add(del.index);
                usedInsertions.add(ins.index);
                break;
            }
        }
    }

    return pairs;
}

/**
 * Reconcile misaligned diffs by marking matched pairs as non-diff
 * This modifies the diffs array in place
 */
export function reconcileMisalignedDiffs(
    diffs: CharacterDiff[],
    options: ReconcileOptions = DEFAULT_OPTIONS
): { reconciledCount: number; pairs: MisalignedPair[] } {
    const pairs = detectMisalignedContent(diffs, options);

    if (pairs.length === 0) {
        return { reconciledCount: 0, pairs: [] };
    }

    // Process each pair
    for (const pair of pairs) {
        const deleteDiff = diffs[pair.deleteIndex];
        const insertDiff = diffs[pair.insertIndex];

        if (!deleteDiff || !insertDiff) continue;

        // For the deletion side: keep only the EQUAL parts, remove DELETE markers
        const newDeleteDiffs: DiffTuple[] = [];
        for (const [op, text] of deleteDiff.diffs) {
            if (op === 0) {
                newDeleteDiffs.push([0, text]);
            } else if (op === -1) {
                // Convert DELETE to EQUAL since content exists on the other side
                newDeleteDiffs.push([0, text]);
            }
            // Skip INSERT (op === 1) as it shouldn't affect delete side
        }

        // For the insertion side: keep only the EQUAL parts, remove INSERT markers
        const newInsertDiffs: DiffTuple[] = [];
        for (const [op, text] of insertDiff.diffs) {
            if (op === 0) {
                newInsertDiffs.push([0, text]);
            } else if (op === 1) {
                // Convert INSERT to EQUAL since content exists on the other side
                newInsertDiffs.push([0, text]);
            }
            // Skip DELETE (op === -1) as it shouldn't affect insert side
        }

        // Update the diffs
        deleteDiff.diffs = newDeleteDiffs;
        deleteDiff.hasDiff = false;
        deleteDiff.reconciled = true;

        insertDiff.diffs = newInsertDiffs;
        insertDiff.hasDiff = false;
        insertDiff.reconciled = true;

        if (options.debug) {
            console.log(`[PostProcess] Reconciled diff pair: ${pair.deleteIndex} <-> ${pair.insertIndex}`);
        }
    }

    return { reconciledCount: pairs.length, pairs };
}

/**
 * Post-process diffs to fix paragraph boundary misalignment issues
 */
export function postProcessDiffs(
    diffs: CharacterDiff[],
    options: ReconcileOptions = DEFAULT_OPTIONS
): CharacterDiff[] {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

    console.log('[PostProcess] Starting post-processing...');

    const { reconciledCount, pairs: _pairs } = reconcileMisalignedDiffs(diffs, mergedOptions);

    console.log(`[PostProcess] Reconciled ${reconciledCount} misaligned pairs`);

    return diffs;
}
