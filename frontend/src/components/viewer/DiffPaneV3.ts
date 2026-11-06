// Diff pane component - renders text diff results
// Renders aligned document changes with shared navigation IDs.

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
    if (state.error) {
      this.container.innerHTML = `<p class="comparison-error">${escapeHtml(state.error)}</p>`;
      return;
    }
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
    let lastBlock: number | undefined = undefined;
    const feedbackAdded = new Set<number>();

    for (const segment of segments) {
      // Add page separator if page changed
      if (segment.pageIdx !== lastPage && segment.pageIdx >= 0) {
        html += `<div class="page-separator">第 ${segment.pageIdx + 1} 页</div>`;
        lastPage = segment.pageIdx;
        lastBlock = undefined;
      }

      if (
        segment.blockIdx !== undefined &&
        segment.blockIdx !== lastBlock &&
        lastBlock !== undefined
      ) {
        html += '<div class="block-separator"></div>';
      }
      lastBlock = segment.blockIdx;

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
          isCurrentDiff = segment.diffId === currentDiffIndex;
          dataAttrs.push(`data-diff-index="${segment.diffId}"`);

          break;
        case 'removed':
          className = 'diff-removed';
          isCurrentDiff = segment.diffId === currentDiffIndex;
          dataAttrs.push(`data-diff-index="${segment.diffId}"`);

          break;
        case 'moved':
          className = 'diff-moved';
          isCurrentDiff = segment.diffId === currentDiffIndex;
          dataAttrs.push(`data-diff-index="${segment.diffId}"`);
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
      if (segment.diffId !== undefined && !feedbackAdded.has(segment.diffId)) {
        feedbackAdded.add(segment.diffId);
        html += `<button type="button" class="diff-feedback-button" data-feedback-diff="${segment.diffId}" data-feedback-side="${this.side}" aria-label="反馈第 ${segment.diffId + 1} 处差异">反馈</button>`;
      }
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
        const bounds = currentDiffElement.getBoundingClientRect();
        const pane = this.container.getBoundingClientRect();
        this.container.scrollTo({
          top:
            this.container.scrollTop +
            bounds.top -
            pane.top -
            (this.container.clientHeight - bounds.height) / 2,
          behavior: 'smooth',
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
