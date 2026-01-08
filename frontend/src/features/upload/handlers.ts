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

    contractActions.setUploadProgress(side, 30, 'MinerU 处理中...');

    // Poll for result
    const result = await pollForResult(
      uploadResult.id,
      cancelToken,
      (progress, message) => {
        contractActions.setUploadProgress(side, progress, message);
      }
    );

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
