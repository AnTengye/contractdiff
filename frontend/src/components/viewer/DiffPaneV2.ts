// Diff pane component V2 - renders text diff results from new engine

import { diffStore, type DiffState } from '@/store';
import { escapeHtml } from '@/utils/html';
import { getRequiredElement } from '@/utils/dom';
import type { CharacterDiff } from '@/services/diff/text';

export class DiffPaneV2 {
  private side: 'left' | 'right';
  private container: HTMLElement;
  private unsubscribe: (() => void) | null = null;

  constructor(side: 'left' | 'right') {
    this.side = side;
    this.container = getRequiredElement(`diff-${side}`);
    console.log(`[DiffPane ${side}] Initialized, container:`, this.container);
    this.subscribeToStore();
  }

  private subscribeToStore(): void {
    console.log(`[DiffPane ${this.side}] Subscribing to store`);
    this.unsubscribe = diffStore.subscribe((state) => {
      console.log(`[DiffPane ${this.side}] Store changed, rendering`);
      this.render(state);
    });
    
    // Render initial state
    const initialState = diffStore.getState();
    console.log(`[DiffPane ${this.side}] Initial state:`, {
      hasComparisonResult: !!initialState.comparisonResult,
      hasParagraphDiffs: !!initialState.paragraphDiffs
    });
    this.render(initialState);
  }

  private render(state: DiffState): void {
    console.log('[DiffPane] Rendering, state:', {
      hasComparisonResult: !!state.comparisonResult,
      hasParagraphDiffs: !!state.paragraphDiffs,
      diffsCount: state.comparisonResult?.textDiff.diffs.length,
      currentDiffIndex: state.currentDiffIndex
    });
    
    // Try new comparison result first
    if (state.comparisonResult) {
      console.log('[DiffPane] Using new comparison result');
      const html = this.renderNewDiffs(state.comparisonResult.textDiff.diffs, state.currentDiffIndex);
      this.container.innerHTML = html;
      
      // Scroll to current diff if needed
      if (state.currentDiffIndex >= 0) {
        this.scrollToCurrentDiff(state.currentDiffIndex);
      }
      return;
    }

    // Fall back to legacy paragraph diffs
    if (state.paragraphDiffs) {
      console.log('[DiffPane] Using legacy paragraph diffs');
      const html = this.renderLegacyDiffs(state.paragraphDiffs);
      this.container.innerHTML = html;
      return;
    }

    console.log('[DiffPane] No results, showing placeholder');
    this.container.innerHTML = '<p class="placeholder">等待比对结果...</p>';
  }

  /**
   * Render diffs from new comparison engine
   */
  private renderNewDiffs(diffs: CharacterDiff[], currentDiffIndex: number): string {
    let html = '';
    let lastPage = -1;
    let diffIndexCounter = 0;

    for (let i = 0; i < diffs.length; i++) {
      const diff = diffs[i]!;
      const block = this.side === 'left' ? diff.leftBlock : diff.rightBlock;
      const pageIdx = block.pageIdx;

      // Add page separator if page changed
      if (pageIdx !== lastPage && pageIdx >= 0) {
        html += `<div class="page-separator">第 ${pageIdx + 1} 页</div>`;
        lastPage = pageIdx;
      }

      // Skip only if both conditions are true:
      // 1. Block has no text
      // 2. Block has no differences
      // This ensures we show additions/deletions even when one side is empty
      if (!block.text && !diff.hasDiff) continue;
      
      // Check if this block has any content to show on this side
      let hasContentOnThisSide = false;
      if (this.side === 'left') {
        // Left side shows deletions (op === -1) and unchanged (op === 0)
        hasContentOnThisSide = diff.diffs.some(([op]) => op === -1 || op === 0);
      } else {
        // Right side shows additions (op === 1) and unchanged (op === 0)
        hasContentOnThisSide = diff.diffs.some(([op]) => op === 1 || op === 0);
      }
      
      // If no content to show on this side, skip rendering this block
      // (the other side will show the addition/deletion)
      if (!hasContentOnThisSide && diff.hasDiff) {
        // Don't show placeholder, just skip
        // The other side will show the actual content
        diffIndexCounter++;
        continue;
      }
      
      // Determine if this is the current diff
      const isCurrentDiff = diff.hasDiff && diffIndexCounter === currentDiffIndex;
      const diffClass = isCurrentDiff ? ' current-diff' : '';
      
      html += `<div class="diff-para${diffClass}" data-diff-index="${diffIndexCounter}" data-block-index="${i}">`;

      if (!diff.hasDiff) {
        // No difference - show original text without any markers
        html += `<span class="unchanged">${escapeHtml(block.text)}</span>`;
      } else {
        // Has differences - render with highlights
        for (const [op, text] of diff.diffs) {
          if (this.side === 'left') {
            // Left side: show deletions (op === -1) and unchanged (op === 0)
            if (op === -1) {
              html += `<span class="diff-removed">${escapeHtml(text)}</span>`;
            } else if (op === 0) {
              html += `<span class="unchanged">${escapeHtml(text)}</span>`;
            }
            // Skip additions on left side
          } else {
            // Right side: show additions (op === 1) and unchanged (op === 0)
            if (op === 1) {
              html += `<span class="diff-added">${escapeHtml(text)}</span>`;
            } else if (op === 0) {
              html += `<span class="unchanged">${escapeHtml(text)}</span>`;
            }
            // Skip deletions on right side
          }
        }
        diffIndexCounter++;
      }

      html += '</div>';
    }

    return html || '<p class="placeholder">无差异</p>';
  }

  /**
   * Scroll to the current diff
   */
  private scrollToCurrentDiff(diffIndex: number): void {
    // Use setTimeout to ensure DOM is updated
    setTimeout(() => {
      const currentDiffElement = this.container.querySelector(`[data-diff-index="${diffIndex}"]`);
      if (currentDiffElement) {
        currentDiffElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'nearest'
        });
      }
    }, 100);
  }

  /**
   * Render legacy paragraph diffs (for backward compatibility)
   */
  private renderLegacyDiffs(paragraphDiffs: any[]): string {
    let html = '';
    let lastPage = -1;

    for (const diff of paragraphDiffs) {
      const para = this.side === 'left' ? diff.left : diff.right;
      const pageIdx = para.pageIdx;

      // Add page separator if page changed
      if (pageIdx !== lastPage && pageIdx >= 0) {
        html += `<div class="page-separator">第 ${pageIdx + 1} 页</div>`;
        lastPage = pageIdx;
      }

      // Skip empty paragraphs
      if (!para.text && !diff.hasDiff) continue;

      html += '<div class="diff-para">';

      if (!diff.hasDiff) {
        // No difference
        html += `<span class="unchanged">${escapeHtml(para.text)}</span>`;
      } else {
        // Has differences - render with highlights
        for (const [op, text] of diff.diffs) {
          if (this.side === 'left') {
            // Left side: show deletions (op === -1) and unchanged (op === 0)
            if (op === -1) {
              html += `<span class="diff-removed">${escapeHtml(text)}</span>`;
            } else if (op === 0) {
              html += `<span class="unchanged">${escapeHtml(text)}</span>`;
            }
            // Skip additions on left side
          } else {
            // Right side: show additions (op === 1) and unchanged (op === 0)
            if (op === 1) {
              html += `<span class="diff-added">${escapeHtml(text)}</span>`;
            } else if (op === 0) {
              html += `<span class="unchanged">${escapeHtml(text)}</span>`;
            }
            // Skip deletions on right side
          }
        }
      }

      html += '</div>';
    }

    return html || '<p class="placeholder">无差异</p>';
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}

// Export legacy DiffPane for backward compatibility
export { DiffPaneV2 as DiffPane };
