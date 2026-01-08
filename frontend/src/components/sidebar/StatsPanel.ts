// Stats panel component
import { diffStore } from '@/store';
import { getRequiredElement } from '@/utils/dom';

export class StatsPanel {
  private elements: {
    added: HTMLElement;
    removed: HTMLElement;
    total: HTMLElement;
  };
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.elements = {
      added: getRequiredElement('stat-added'),
      removed: getRequiredElement('stat-removed'),
      total: getRequiredElement('stat-total'),
    };
    this.subscribeToStore();
  }

  private subscribeToStore(): void {
    this.unsubscribe = diffStore.subscribe((state) => {
      this.render(state.stats);
    });
  }

  private render(stats: { added: number; removed: number; total: number }): void {
    this.elements.added.textContent = String(stats.added);
    this.elements.removed.textContent = String(stats.removed);
    this.elements.total.textContent = String(stats.total);
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
