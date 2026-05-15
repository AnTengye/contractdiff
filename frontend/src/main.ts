// Main application entry point
import { UploadCard, DiffPane, PdfViewer, StatsPanel, setupZoomControls } from '@/components';
import { runComparisonV3 } from '@/features/comparison';
import { setupSyncScroll } from '@/features/sync';
import { DiffNavigation } from '@/features/navigation/diffNavigation';
import { contractStore, selectCanCompare, uiStore } from '@/store';
import { getCurrentUser, getParsers } from '@/services/api';
import { isAuthenticated, redirectToLogin, clearAuth, getUser } from '@/utils/auth';
import { getRequiredElement, getElementById, toggle } from '@/utils/dom';

const DEFAULT_PARSER = { id: 'mineru', name: 'MinerU' };

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
  const leftSelector = getElementById<HTMLSelectElement>('parser-selector-left');
  const rightSelector = getElementById<HTMLSelectElement>('parser-selector-right');

  try {
    const parsers = await getParsers();
    renderParserOptions([leftSelector, rightSelector], parsers);
  } catch (error) {
    console.warn('Failed to load parsers:', error);
    renderParserOptions([leftSelector, rightSelector], []);
  }
}

function renderParserOptions(selectors: Array<HTMLSelectElement | null>, parsers: Array<{ id: string; name: string }>): void {
  const availableParsers = parsers.length > 0 ? parsers : [DEFAULT_PARSER];
  const options = availableParsers.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const selectedParserId = availableParsers.some(p => p.id === DEFAULT_PARSER.id)
    ? DEFAULT_PARSER.id
    : availableParsers[0]?.id;

  selectors.forEach(selector => {
    if (!selector) return;
    selector.innerHTML = options;
    if (selectedParserId) {
      selector.value = selectedParserId;
    }
  });
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
  new DiffNavigation();

  // Setup zoom controls
  setupZoomControls();

  // Setup compare button
  const compareBtn = getRequiredElement('compare-btn');

  compareBtn.addEventListener('click', () => {
    // Use new V3 jsdiff-based comparison engine
    runComparisonV3();
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
