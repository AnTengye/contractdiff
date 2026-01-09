// Upload feature - event handlers
import { contractActions, contractStore } from '@/store';
import { uploadContract, pollForResult } from '@/services/api';
import type { FileType, CancelToken } from '@/types';

/**
 * Handle file upload for a side
 */
export async function handleFileUpload(file: File, side: 'left' | 'right'): Promise<void> {
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
    const uploadResult = await uploadContract(file, parserId);

    // Check cancellation after upload
    if (cancelToken.cancelled) {
      throw new Error('Cancelled');
    }

    let result;

    // Check if this is a cached/duplicate upload - skip polling
    if (uploadResult.is_duplicate && uploadResult.status === 'completed') {
      contractActions.setUploadProgress(side, 90, '使用缓存结果...');

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
      // Normal flow - poll for result
      contractActions.setUploadProgress(side, 30, 'MinerU 处理中...');

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
      file.name
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
