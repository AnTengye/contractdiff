// Main application entry point
import { UploadCard, DiffPane, PdfViewer, StatsPanel, setupZoomControls } from '@/components';
import { runComparison } from '@/features/comparison';
import { setupSyncScroll } from '@/features/sync';
import { contractStore, selectCanCompare, uiStore } from '@/store';
import { getCurrentUser, getParsers } from '@/services/api';
import { isAuthenticated, redirectToLogin, clearAuth, getUser } from '@/utils/auth';
import { getRequiredElement, getElementById, toggle } from '@/utils/dom';

// Check authentication on load
async function checkAuth(): Promise<boolean> {
  if (!isAuthenticated()) {
    redirectToLogin();
    return false;
  }

  const user = await getCurrentUser();
  if (!user) {
    redirectToLogin();
    return false;
  }

  // Update user display
  const userInfo = getElementById('user-info');
  const userDisplay = getElementById('user-display');

  if (userInfo) userInfo.style.display = 'flex';
  if (userDisplay) {
    const storedUser = getUser();
    userDisplay.textContent = storedUser?.username || user.username;
  }

  return true;
}

// Load available parsers
async function loadParsers(): Promise<void> {
  try {
    const parsers = await getParsers();

    const leftSelector = getElementById<HTMLSelectElement>('parser-selector-left');
    const rightSelector = getElementById<HTMLSelectElement>('parser-selector-right');

    const options = parsers.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    const defaultOption = '<option value="">默认解析器</option>';

    if (leftSelector) leftSelector.innerHTML = defaultOption + options;
    if (rightSelector) rightSelector.innerHTML = defaultOption + options;
  } catch (error) {
    console.warn('Failed to load parsers:', error);
  }
}

// Initialize application
async function init(): Promise<void> {
  // Check auth first
  const authed = await checkAuth();
  if (!authed) return;

  // Load parsers
  await loadParsers();

  // Initialize components (instances manage their own lifecycle)
  new UploadCard('left');
  new UploadCard('right');
  new DiffPane('left');
  new DiffPane('right');
  new PdfViewer('left');
  new PdfViewer('right');
  new StatsPanel();

  // Setup zoom controls
  setupZoomControls();

  // Setup compare button
  const compareBtn = getRequiredElement('compare-btn');

  compareBtn.addEventListener('click', () => {
    runComparison();
  });

  // Update compare button state based on data availability
  contractStore.subscribeToSelector(selectCanCompare, (canCompare) => {
    compareBtn.classList.toggle('disabled', !canCompare);
    (compareBtn as HTMLButtonElement).disabled = !canCompare;
  });

  // Subscribe to UI store for section visibility
  const pdfSection = getElementById('pdf-section');
  const diffSection = getElementById('diff-section');

  uiStore.subscribe((state) => {
    if (pdfSection) toggle(pdfSection, state.showPdfSection);
    if (diffSection) toggle(diffSection, state.showDiffSection);
  });

  // Setup synchronized scrolling for diff panes
  const diffLeft = getElementById('diff-left');
  const diffRight = getElementById('diff-right');
  if (diffLeft && diffRight) {
    setupSyncScroll(diffLeft, diffRight);
  }

  // Setup synchronized scrolling for PDF viewers
  const pdfLeft = getElementById('pdf-pages-left');
  const pdfRight = getElementById('pdf-pages-right');
  if (pdfLeft && pdfRight) {
    setupSyncScroll(pdfLeft, pdfRight);
  }

  // Expose logout function globally
  (window as unknown as { logout: () => void }).logout = () => {
    clearAuth();
    redirectToLogin();
  };

  console.log('ContractDiff initialized');
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
