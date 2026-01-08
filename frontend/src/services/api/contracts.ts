// Contract API functions
import { API_ENDPOINTS, POLLING } from '@/constants';
import { getToken } from '@/utils/auth';
import type { ContractData, CancelToken } from '@/types';

interface UploadResponse {
  id: string;
  pdf_url: string;
}

interface ContractStatusResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

interface ContractDetailResponse {
  id: string;
  status: string;
  data: ContractData | null;
  pdf_url: string;
  created_at: string;
}

export interface PollResult {
  data: ContractData;
  pdfUrl: string;
}

/**
 * Upload a contract file
 */
export async function uploadContract(
  file: File,
  parserId?: string
): Promise<UploadResponse> {
  const token = getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const formData = new FormData();
  formData.append('file', file);
  if (parserId) {
    formData.append('parser_id', parserId);
  }

  const response = await fetch(API_ENDPOINTS.CONTRACTS_UPLOAD, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error || 'Upload failed');
  }

  return response.json();
}

/**
 * Get contract status
 */
export async function getContractStatus(
  contractId: string
): Promise<ContractStatusResponse> {
  const token = getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(API_ENDPOINTS.CONTRACTS_STATUS(contractId), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get status' }));
    throw new Error(error.error || 'Failed to get status');
  }

  return response.json();
}

/**
 * Get contract detail with parsed data
 */
export async function getContractDetail(
  contractId: string
): Promise<ContractDetailResponse> {
  const token = getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(API_ENDPOINTS.CONTRACTS_DETAIL(contractId), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get contract' }));
    throw new Error(error.error || 'Failed to get contract');
  }

  return response.json();
}

/**
 * Poll for contract processing result
 */
export async function pollForResult(
  contractId: string,
  cancelToken: CancelToken,
  onProgress?: (progress: number, message: string) => void
): Promise<PollResult> {
  let attempts = 0;

  while (attempts < POLLING.MAX_ATTEMPTS) {
    // Check for cancellation
    if (cancelToken.cancelled) {
      throw new Error('Cancelled');
    }

    attempts++;
    const progress = 30 + Math.min(60, (attempts / POLLING.MAX_ATTEMPTS) * 60);
    onProgress?.(progress, `MinerU 处理中... (${attempts}/${POLLING.MAX_ATTEMPTS})`);

    try {
      const status = await getContractStatus(contractId);

      if (status.status === 'completed') {
        onProgress?.(95, '获取处理结果...');
        const detail = await getContractDetail(contractId);

        if (!detail.data) {
          throw new Error('No data in completed contract');
        }

        return {
          data: detail.data,
          pdfUrl: detail.pdf_url,
        };
      }

      if (status.status === 'failed') {
        throw new Error(status.error || 'Processing failed');
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, POLLING.INTERVAL_MS));
    } catch (error) {
      if (error instanceof Error && error.message === 'Cancelled') {
        throw error;
      }
      // Continue polling on transient errors
      console.warn('Poll error, retrying:', error);
    }
  }

  throw new Error(`Processing timeout after ${POLLING.TIMEOUT_MINUTES} minutes`);
}
