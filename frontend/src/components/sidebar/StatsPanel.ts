// Stats panel component
import { diffStore } from '@/store';
import { getRequiredElement } from '@/utils/dom';
import type { DiffStats } from '@/types';

export class StatsPanel {
  private elements: {
    added: HTMLElement;
    removed: HTMLElement;
    modified: HTMLElement;
    total: HTMLElement;
    unmappedNotice: HTMLElement;
    unmappedCount: HTMLElement;
  };
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.elements = {
      added: getRequiredElement('stat-added'),
      removed: getRequiredElement('stat-removed'),
      modified: getRequiredElement('stat-modified'),
      total: getRequiredElement('stat-total'),
      unmappedNotice: getRequiredElement('unmapped-notice'),
      unmappedCount: getRequiredElement('unmapped-count'),
    };
    this.subscribeToStore();
  }

  private subscribeToStore(): void {
    this.unsubscribe = diffStore.subscribe((state) => {
      this.render(state.stats);
    });
  }

  private render(stats: DiffStats): void {
    this.elements.added.textContent = String(stats.added);
    this.elements.removed.textContent = String(stats.removed);
    this.elements.modified.textContent = String(stats.modified);
    this.elements.total.textContent = String(stats.total);

    // Show/hide unmapped notice
    if (stats.visualStats && stats.visualStats.unmapped > 0) {
      this.elements.unmappedNotice.style.display = 'block';
      this.elements.unmappedCount.textContent = String(stats.visualStats.unmapped);
    } else {
      this.elements.unmappedNotice.style.display = 'none';
    }
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
