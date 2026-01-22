// Upload card component
import { contractStore, type ContractSideState } from '@/store';
import { handleFileUpload, cancelUpload, reprocessFile } from '@/features/upload';
import { getRequiredElement, hide, show } from '@/utils/dom';

export class UploadCard {
  private side: 'left' | 'right';
  private elements: {
    card: HTMLElement;
    fileInput: HTMLInputElement;
    info: HTMLElement;
    progressContainer: HTMLElement;
    progressFill: HTMLElement;
    progressText: HTMLElement;
    cancelBtn: HTMLElement;
    contractIdDisplay: HTMLElement;
    parserSelector: HTMLSelectElement;
    reprocessBtn: HTMLElement | null;
  };

  private unsubscribe: (() => void) | null = null;

  constructor(side: 'left' | 'right') {
    this.side = side;
    this.elements = this.initElements();
    this.createReprocessButton();
    this.bindEvents();
    this.subscribeToStore();
  }

  private initElements() {
    return {
      card: getRequiredElement(`upload-${this.side}`),
      fileInput: getRequiredElement<HTMLInputElement>(`file-${this.side}`),
      info: getRequiredElement(`info-${this.side}`),
      progressContainer: getRequiredElement(`progress-${this.side}`),
      progressFill: getRequiredElement(`progress-fill-${this.side}`),
      progressText: getRequiredElement(`progress-text-${this.side}`),
      cancelBtn: getRequiredElement(`cancel-btn-${this.side}`),
      contractIdDisplay: getRequiredElement(`contract-id-${this.side}`),
      parserSelector: getRequiredElement<HTMLSelectElement>(`parser-selector-${this.side}`),
      reprocessBtn: null as HTMLElement | null,
    };
  }

  private createReprocessButton(): void {
    const btn = document.createElement('button');
    btn.id = `reprocess-btn-${this.side}`;
    btn.className = 'reprocess-btn cancel-action';
    btn.textContent = '重新处理';
    btn.title = '清除缓存并重新解析文件';
    btn.style.display = 'none';
    
    this.elements.contractIdDisplay.parentElement?.appendChild(btn);
    this.elements.reprocessBtn = btn;
  }

  private bindEvents(): void {
    // Click to upload
    this.elements.card.addEventListener('click', (e) => {
      // Don't trigger if clicking on specific interactive elements
      const target = e.target as HTMLElement;
      if (target.closest('.parser-selector-container') || target.closest('.cancel-action')) {
        return;
      }
      this.elements.fileInput.click();
    });

    // File input change
    this.elements.fileInput.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        handleFileUpload(file, this.side);
      }
    });

// Cancel button
    this.elements.cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelUpload(this.side);
    });

    // Reprocess button
    this.elements.reprocessBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleReprocess();
    });

    // Drag and drop
    this.elements.card.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.elements.card.classList.add('dragover');
    });

    this.elements.card.addEventListener('dragleave', () => {
      this.elements.card.classList.remove('dragover');
    });

    this.elements.card.addEventListener('drop', (e) => {
      e.preventDefault();
      this.elements.card.classList.remove('dragover');
      const file = e.dataTransfer?.files[0];
      if (file) {
        handleFileUpload(file, this.side);
      }
    });
  }

  private subscribeToStore(): void {
    this.unsubscribe = contractStore.subscribe((state, prevState) => {
      const sideState = state[this.side];
      const prevSideState = prevState[this.side];

      // Only update if this side changed
      if (sideState !== prevSideState) {
        this.render(sideState);
      }
    });
  }

  private render(state: ContractSideState): void {
    const { card, info, progressContainer, progressFill, progressText, cancelBtn, contractIdDisplay } = this.elements;

    if (state.isUploading) {
      // Show progress
      card.classList.add('uploading');
      show(progressContainer);
      progressFill.style.width = `${state.uploadProgress}%`;
      progressText.textContent = state.progressText;
      show(cancelBtn);
      hide(info);
    } else if (state.error) {
      // Show error
      card.classList.remove('uploading', 'has-file');
      hide(progressContainer);
      show(info);
      info.textContent = `❌ ${state.error}`;
      info.style.color = 'var(--error)';
} else if (state.data) {
      // Show success
      card.classList.remove('uploading');
      card.classList.add('has-file');
      hide(progressContainer);
      show(info);
      
      if (state.isCached) {
        info.textContent = `✓ ${state.fileName || 'File loaded'} (缓存)`;
        info.style.color = 'var(--warning, #f59e0b)';
        if (this.elements.reprocessBtn) {
          this.elements.reprocessBtn.style.display = 'inline-block';
        }
      } else {
        info.textContent = `✓ ${state.fileName || 'File loaded'}`;
        info.style.color = 'var(--success)';
        if (this.elements.reprocessBtn) {
          this.elements.reprocessBtn.style.display = 'none';
        }
      }

      if (state.contractId) {
        contractIdDisplay.textContent = `ID: ${state.contractId.substring(0, 8)}...`;
        contractIdDisplay.title = state.contractId;
      }
    } else {
// Initial state
      card.classList.remove('uploading', 'has-file');
      hide(progressContainer);
      hide(info);
      contractIdDisplay.textContent = '';
      if (this.elements.reprocessBtn) {
        this.elements.reprocessBtn.style.display = 'none';
      }
    }
  }

  private async handleReprocess(): Promise<void> {
    try {
      await reprocessFile(this.side);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reprocess failed';
      console.error('Reprocess failed:', message);
    }
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
