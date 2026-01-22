// Upload feature - event handlers
import { contractActions, contractStore } from '@/store';
import { uploadContract, pollForResult, invalidateCache } from '@/services/api';
import type { FileType, CancelToken } from '@/types';

/**
 * Handle file upload for a side
 */
export async function handleFileUpload(
  file: File,
  side: 'left' | 'right',
  forceReprocess = false
): Promise<void> {
  // Detect file type
  const fileType: FileType = file.name.toLowerCase().endsWith('.docx') ? 'docx' : 'pdf';

  // Create cancellation token
  const cancelToken: CancelToken = { cancelled: false };
  contractActions.setCancelToken(side, cancelToken);

  // Start upload
  contractActions.setUploadProgress(side, 10, '上传中...');

  try {
    // Check cancellation
    if (cancelToken.cancelled) {
      throw new Error('Cancelled');
    }

    // Get selected parser
    const parserSelector = document.getElementById(`parser-selector-${side}`) as HTMLSelectElement | null;
    const parserId = parserSelector?.value || undefined;

    // Upload file
    const uploadResult = await uploadContract(file, parserId, forceReprocess);

    // Check cancellation after upload
    if (cancelToken.cancelled) {
      throw new Error('Cancelled');
    }

    let result;
    let isCached = false;

    // Check if this is a cached/duplicate upload - skip polling
    if (uploadResult.is_duplicate && uploadResult.status === 'completed') {
      contractActions.setUploadProgress(side, 90, '使用缓存结果...');
      isCached = true;

      // Fetch the contract details directly since it's already processed
      const { getContractDetail } = await import('@/services/api');
      const detail = await getContractDetail(uploadResult.id);

      if (!detail.json_data) {
        throw new Error('Cached contract has no data');
      }

      // Use PDF proxy endpoint to bypass CORS issues with MinIO
      const { API_ENDPOINTS } = await import('@/constants');
      result = {
        data: detail.json_data,
        pdfUrl: API_ENDPOINTS.CONTRACTS_PDF(uploadResult.id),
      };
    } else {
      const selectedOption = parserSelector?.options[parserSelector.selectedIndex];
      const parserName = selectedOption?.text || '解析器';
      contractActions.setUploadProgress(side, 30, `${parserName} 处理中...`);

      // Poll for result
      result = await pollForResult(
        uploadResult.id,
        cancelToken,
        (progress, message) => {
          contractActions.setUploadProgress(side, progress, message);
        }
      );
    }

    // Check cancellation
    if (cancelToken.cancelled) {
      throw new Error('Cancelled');
    }

    // Success - update store
    contractActions.setData(
      side,
      result.data,
      uploadResult.id,
      result.pdfUrl,
      fileType,
      file.name,
      isCached
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Cancelled') {
      // Already handled by cancelUpload
      return;
    }

    const message = error instanceof Error ? error.message : 'Upload failed';
    contractActions.setUploadError(side, message);
  } finally {
    contractActions.setCancelToken(side, null);
  }
}

/**
 * Cancel upload for a side
 */
export function cancelUpload(side: 'left' | 'right'): void {
  contractActions.cancelUpload(side);
}

/**
 * Check if both sides have data and can compare
 */
export function canCompare(): boolean {
  const state = contractStore.getState();
  return state.left.data !== null && state.right.data !== null;
}

/**
 * Reprocess a cached file by invalidating cache and re-uploading
 */
export async function reprocessFile(side: 'left' | 'right'): Promise<void> {
  const state = contractStore.getState();
  const sideState = state[side];

  if (!sideState.contractId || !sideState.fileName) {
    throw new Error('No file to reprocess');
  }

  // Invalidate cache first
  await invalidateCache(sideState.contractId);

  // Get the file input element to access the original file
  const fileInput = document.getElementById(`file-${side}`) as HTMLInputElement | null;
  const file = fileInput?.files?.[0];

  if (!file) {
    // Reset the side state and prompt user to re-select
    contractActions.resetSide(side);
    throw new Error('Please re-select the file to reprocess');
  }

  // Re-upload with force reprocess
  await handleFileUpload(file, side, true);
}
