// Diff navigation controller - handles navigation between differences

import { diffStore, diffActions } from '@/store';

export class DiffNavigation {
  private unsubscribe: (() => void) | null = null;
  private prevBtn: HTMLButtonElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;
  private counterEl: HTMLElement | null = null;
  private controlsEl: HTMLElement | null = null;

  constructor() {
    this.initElements();
    this.setupEventListeners();
    this.subscribeToStore();
  }

  private initElements(): void {
    this.prevBtn = document.getElementById('prev-diff-btn') as HTMLButtonElement;
    this.nextBtn = document.getElementById('next-diff-btn') as HTMLButtonElement;
    this.counterEl = document.getElementById('diff-counter');
    this.controlsEl = document.getElementById('diff-nav-controls');
  }

  private setupEventListeners(): void {
    // Button clicks
    if (this.prevBtn) {
      this.prevBtn.addEventListener('click', () => this.previousDiff());
    }
    if (this.nextBtn) {
      this.nextBtn.addEventListener('click', () => this.nextDiff());
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyPress(e));
  }

  private subscribeToStore(): void {
    this.unsubscribe = diffStore.subscribe((state) => {
      this.updateUI(state);
    });

    // Initial update
    this.updateUI(diffStore.getState());
  }

  private updateUI(state: typeof diffStore extends { getState(): infer S } ? S : never): void {
    const { currentDiffIndex, totalDiffs } = state;

    // Show/hide controls based on whether there are diffs
    if (this.controlsEl) {
      if (totalDiffs > 0) {
        this.controlsEl.style.display = 'flex';
      } else {
        this.controlsEl.style.display = 'none';
      }
    }

    // Update counter
    if (this.counterEl) {
      if (totalDiffs > 0 && currentDiffIndex >= 0) {
        this.counterEl.textContent = `${currentDiffIndex + 1} / ${totalDiffs}`;
      } else {
        this.counterEl.textContent = `0 / 0`;
      }
    }

    // Update button states
    if (this.prevBtn) {
      this.prevBtn.disabled = currentDiffIndex <= 0;
    }
    if (this.nextBtn) {
      this.nextBtn.disabled = currentDiffIndex >= totalDiffs - 1;
    }
  }

  private handleKeyPress(e: KeyboardEvent): void {
    // Ignore if user is typing in an input field
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }

    const state = diffStore.getState();
    if (state.totalDiffs === 0) return;

    switch (e.key) {
      case 'ArrowDown':
      case 'j':
      case 'J':
        e.preventDefault();
        this.nextDiff();
        break;
      case 'ArrowUp':
      case 'k':
      case 'K':
        e.preventDefault();
        this.previousDiff();
        break;
      case 'Home':
        e.preventDefault();
        diffActions.goToDiff(0);
        break;
      case 'End':
        e.preventDefault();
        diffActions.goToDiff(state.totalDiffs - 1);
        break;
    }
  }

  private nextDiff(): void {
    diffActions.nextDiff();
  }

  private previousDiff(): void {
    diffActions.previousDiff();
  }

  public goToDiff(index: number): void {
    diffActions.goToDiff(index);
  }

  public destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    document.removeEventListener('keydown', (e) => this.handleKeyPress(e));
  }
}
