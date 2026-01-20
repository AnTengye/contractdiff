// Diff pane component - renders text diff results
// Uses jsdiff-based whole-document comparison

import { diffStore, type DiffState } from '@/store';
import { escapeHtml } from '@/utils/html';
import { getRequiredElement } from '@/utils/dom';
import type { RenderSegment } from '@/services/diff/textv2';

export class DiffPaneV3 {
  private side: 'left' | 'right';
  private container: HTMLElement;
  private unsubscribe: (() => void) | null = null;

  constructor(side: 'left' | 'right') {
    this.side = side;
    this.container = getRequiredElement(`diff-${side}`);
    console.log(`[DiffPane ${side}] Initialized`);
    this.subscribeToStore();
  }

  private subscribeToStore(): void {
    this.unsubscribe = diffStore.subscribe((state) => {
      this.render(state);
    });

    // Render initial state
    this.render(diffStore.getState());
  }

  private render(state: DiffState): void {
    if (state.textDiffResult) {
      const result = state.textDiffResult;
      const sideResult = this.side === 'left' ? result.left : result.right;
      const html = this.renderSegments(sideResult.segments, state.currentDiffIndex);
      this.container.innerHTML = html;

      // Scroll to current diff if needed
      if (state.currentDiffIndex >= 0) {
        this.scrollToCurrentDiff(state.currentDiffIndex);
      }
      return;
    }

    this.container.innerHTML = '<p class="placeholder">等待比对结果...</p>';
  }

  /**
   * Render segments from diff engine
   */
  private renderSegments(segments: RenderSegment[], currentDiffIndex: number): string {
    let html = '';
    let lastPage = -1;
    let diffIndex = 0;

    for (const segment of segments) {
      // Add page separator if page changed
      if (segment.pageIdx !== lastPage && segment.pageIdx >= 0) {
        html += `<div class="page-separator">第 ${segment.pageIdx + 1} 页</div>`;
        lastPage = segment.pageIdx;
      }

      // Skip empty unchanged segments
      if (segment.type === 'unchanged' && !segment.text.trim()) {
        continue;
      }

      // Determine CSS class and track diff index
      let className = '';
      let isCurrentDiff = false;
      const dataAttrs: string[] = [];

      switch (segment.type) {
        case 'added':
          className = 'diff-added';
          isCurrentDiff = diffIndex === currentDiffIndex;
          dataAttrs.push(`data-diff-index="${diffIndex}"`);
          diffIndex++;
          break;
        case 'removed':
          className = 'diff-removed';
          isCurrentDiff = diffIndex === currentDiffIndex;
          dataAttrs.push(`data-diff-index="${diffIndex}"`);
          diffIndex++;
          break;
        case 'unchanged':
          className = 'unchanged';
          break;
      }

      if (isCurrentDiff) {
        className += ' current-diff';
      }

      const escapedText = escapeHtml(segment.text).replace(/\n/g, '<br>');
      html += `<span class="${className}" ${dataAttrs.join(' ')}>${escapedText}</span>`;
    }

    return html || '<p class="placeholder">无差异</p>';
  }

  /**
   * Scroll to the current diff
   */
  private scrollToCurrentDiff(diffIndex: number): void {
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

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}

// Export as DiffPane for compatibility
export { DiffPaneV3 as DiffPane };
