// Scroll synchronization feature
import { uiStore, uiActions } from '@/store';
import { SYNC_SCROLL } from '@/constants';

let syncTimeout: number | null = null;

/**
 * Setup synchronized scrolling between two containers
 */
export function setupSyncScroll(
  leftContainer: HTMLElement,
  rightContainer: HTMLElement
): () => void {
  const handleScroll = (source: HTMLElement, target: HTMLElement) => {
    const state = uiStore.getState();
    if (!state.syncScrollEnabled || state.isSyncing) return;

    uiActions.setIsSyncing(true);

    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }

    if (state.syncScrollMode === 'percentage') {
      // Sync by percentage
      const scrollPercentage = source.scrollTop / (source.scrollHeight - source.clientHeight);
      target.scrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight);
    } else {
      // Anchor-based sync (more complex, simplified here)
      const ratio = source.scrollTop / source.scrollHeight;
      target.scrollTop = ratio * target.scrollHeight;
    }

    syncTimeout = window.setTimeout(() => {
      uiActions.setIsSyncing(false);
    }, SYNC_SCROLL.DEBOUNCE_MS);
  };

  const leftHandler = () => handleScroll(leftContainer, rightContainer);
  const rightHandler = () => handleScroll(rightContainer, leftContainer);

  leftContainer.addEventListener('scroll', leftHandler);
  rightContainer.addEventListener('scroll', rightHandler);

  // Return cleanup function
  return () => {
    leftContainer.removeEventListener('scroll', leftHandler);
    rightContainer.removeEventListener('scroll', rightHandler);
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }
  };
}

/**
 * Toggle sync scroll
 */
export function toggleSyncScroll(): void {
  uiActions.toggleSyncScroll();
}

/**
 * Get sync scroll state
 */
export function isSyncScrollEnabled(): boolean {
  return uiStore.getState().syncScrollEnabled;
}
