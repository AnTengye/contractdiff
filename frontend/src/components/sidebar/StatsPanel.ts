// Stats panel component - inline version below compare button
import { diffStore } from '@/store';
import { getElementById } from '@/utils/dom';
import type { DiffStats } from '@/types';

export class StatsPanel {
  private elements: {
    container: HTMLElement | null;
    added: HTMLElement | null;
    removed: HTMLElement | null;
    total: HTMLElement | null;
  };
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.elements = {
      container: getElementById('diff-stats-inline'),
      added: getElementById('inline-stat-added'),
      removed: getElementById('inline-stat-removed'),
      total: getElementById('inline-stat-total'),
    };
    this.subscribeToStore();
  }

  private subscribeToStore(): void {
    this.unsubscribe = diffStore.subscribe((state) => {
      this.render(state.stats);
    });
  }

  private render(stats: DiffStats): void {
    if (!this.elements.container) return;

    if (stats.total > 0) {
      this.elements.container.style.display = 'flex';
      if (this.elements.total) this.elements.total.textContent = String(stats.total);
      if (this.elements.added) this.elements.added.textContent = String(stats.added);
      if (this.elements.removed) this.elements.removed.textContent = String(stats.removed);
    } else {
      this.elements.container.style.display = 'none';
    }
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
