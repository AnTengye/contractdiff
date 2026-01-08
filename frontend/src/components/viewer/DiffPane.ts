// Diff pane component - renders text diff results
import { diffStore, type DiffState } from '@/store';
import { escapeHtml } from '@/utils/html';
import { getRequiredElement } from '@/utils/dom';
import type { ParagraphDiff } from '@/types';

export class DiffPane {
  private side: 'left' | 'right';
  private container: HTMLElement;
  private unsubscribe: (() => void) | null = null;

  constructor(side: 'left' | 'right') {
    this.side = side;
    this.container = getRequiredElement(`diff-${side}`);
    this.subscribeToStore();
  }

  private subscribeToStore(): void {
    this.unsubscribe = diffStore.subscribe((state) => {
      this.render(state);
    });
  }

  private render(state: DiffState): void {
    if (!state.paragraphDiffs) {
      this.container.innerHTML = '<p class="placeholder">等待比对结果...</p>';
      return;
    }

    const html = this.renderDiffs(state.paragraphDiffs);
    this.container.innerHTML = html;
  }

  private renderDiffs(paragraphDiffs: ParagraphDiff[]): string {
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
