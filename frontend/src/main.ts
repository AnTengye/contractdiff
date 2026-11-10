// Main application entry point
import { UploadCard, DiffPane, PdfViewer, StatsPanel, setupZoomControls } from '@/components';
import { FeedbackPanel } from '@/features/feedback/FeedbackPanel';
import { diffStore } from '@/store';
import { cancelComparison } from '@/features/comparison/comparisonV3';
import { runComparisonV3 } from '@/features/comparison';
import { AIReviewPanel } from '@/features/comparison/AIReviewPanel';
import { setupSyncScroll } from '@/features/sync';
import { DiffNavigation } from '@/features/navigation/diffNavigation';
import { contractStore, selectCanCompare, uiStore } from '@/store';
import { getCurrentUser, getParsers } from '@/services/api';
import { setDocxUploadAvailable } from '@/features/upload';
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
    const catalog = await getParsers();
    renderParserOptions([leftSelector, rightSelector], catalog.parsers);
    configureUploadFormats(catalog.docxAvailable);
  } catch (error) {
    console.warn('Failed to load parsers:', error);
    renderParserOptions([leftSelector, rightSelector], []);
    configureUploadFormats(false);
  }
}

function configureUploadFormats(docxAvailable: boolean): void {
  setDocxUploadAvailable(docxAvailable);
  const accept = docxAvailable ? '.pdf,.docx' : '.pdf';
  const label = docxAvailable ? '点击或拖拽上传 PDF/DOCX' : '点击或拖拽上传 PDF';
  for (const side of ['left', 'right'] as const) {
    const input = getElementById<HTMLInputElement>(`file-${side}`);
    const hint = document.querySelector<HTMLElement>(`#upload-${side} .upload-hint`);
    if (input) input.accept = accept;
    if (hint) hint.textContent = label;
  }
}

function renderParserOptions(
  selectors: Array<HTMLSelectElement | null>,
  parsers: Array<{ id: string; name: string }>
): void {
  const availableParsers = parsers.length > 0 ? parsers : [DEFAULT_PARSER];
  const options = availableParsers
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');
  const selectedParserId = availableParsers.some((p) => p.id === DEFAULT_PARSER.id)
    ? DEFAULT_PARSER.id
    : availableParsers[0]?.id;

  selectors.forEach((selector) => {
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
  new AIReviewPanel();
  const user = await getCurrentUser();
  new FeedbackPanel(user?.can_review_feedback ?? false);

  // Setup zoom controls
  setupZoomControls();

  // Setup compare button
  const compareBtn = getRequiredElement('compare-btn');

  compareBtn.addEventListener('click', () => {
    // Use new V3 jsdiff-based comparison engine
    if (diffStore.getState().isComparing) cancelComparison();
    else void runComparisonV3();
  });

  // Update compare button state based on data availability
  contractStore.subscribeToSelector(selectCanCompare, (canCompare) => {
    compareBtn.classList.toggle('disabled', !canCompare);
    (compareBtn as HTMLButtonElement).disabled = !canCompare;
  });

  diffStore.subscribe((state) => {
    compareBtn.textContent = state.isComparing ? '取消比对' : '开始智能比对';
    const status = document.getElementById('comparison-status');
    if (status)
      status.textContent = state.isComparing
        ? '正在比对…'
        : (state.error ??
          (state.textDiffResult
            ? `算法比对完成，共 ${state.stats.total} 处文字/结构差异。${state.aiStatus === 'running'?'AI 正在异步识别，可继续查看原件。':''}${state.textDiffResult.metadata?.warnings.join('') ?? ''}`
            : ''));
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
  const pdfLeft = getElementById('pdf-viewer-left');
  const pdfRight = getElementById('pdf-viewer-right');
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
