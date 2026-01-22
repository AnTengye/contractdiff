// Contract API functions
import { API_ENDPOINTS, POLLING } from '@/constants';
import { getToken } from '@/utils/auth';
import type { ContractData, CancelToken } from '@/types';

interface UploadResponse {
  id: string;
  pdf_url?: string;
  filename?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  is_duplicate?: boolean;
  original_id?: string;
  message?: string;
}

interface ContractStatusResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

interface ContractDetailResponse {
  id: string;
  status: string;
  json_data: ContractData | null;
  pdf_url: string;
  file_url?: string;
  converted_file_url?: string;
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
  parserId?: string,
  forceReprocess = false
): Promise<UploadResponse> {
  const token = getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const formData = new FormData();
  formData.append('file', file);
  if (parserId) {
    formData.append('parser_type', parserId);
  }
  if (forceReprocess) {
    formData.append('force_reprocess', 'true');
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

  if (response.status === 429) {
    throw new Error('RateLimit');
  }

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
  let currentInterval: number = POLLING.INTERVAL_MS;
  let rateLimitBackoff = 0;

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

      // Reset backoff on successful request
      rateLimitBackoff = 0;
      currentInterval = POLLING.INTERVAL_MS;

      if (status.status === 'completed') {
        onProgress?.(95, '获取处理结果...');

        // Retry fetching detail a few times - sometimes data isn't ready immediately
        let detailRetries = 3;
        while (detailRetries > 0) {
          const detail = await getContractDetail(contractId);

          if (detail.json_data) {
            // Use PDF proxy endpoint to bypass CORS issues
            return {
              data: detail.json_data,
              pdfUrl: `/api/contracts/${contractId}/pdf`,
            };
          }

          detailRetries--;
          if (detailRetries > 0) {
            console.warn('Contract completed but data not ready, retrying...');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        throw new Error('Contract completed but data not available');
      }

      if (status.status === 'failed') {
        const error = new Error(status.error || 'Processing failed');
        (error as any).isPermanent = true;
        throw error;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, currentInterval));
    } catch (error) {
      if (error instanceof Error && error.message === 'Cancelled') {
        throw error;
      }

      // Re-throw permanent errors to stop polling
      if (error && (error as any).isPermanent) {
        throw error;
      }

      // Handle rate limiting with exponential backoff
      if (error instanceof Error && error.message === 'RateLimit') {
        rateLimitBackoff++;
        const backoffMs = Math.min(30000, POLLING.INTERVAL_MS * Math.pow(2, rateLimitBackoff));
        console.warn(`Rate limited, backing off for ${backoffMs}ms`);
        onProgress?.(progress, `请求过于频繁，等待 ${Math.round(backoffMs / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        currentInterval = backoffMs;
        continue;
      }

      // Continue polling on other transient errors
      console.warn('Poll error, retrying:', error);
      await new Promise(resolve => setTimeout(resolve, currentInterval));
    }
  }

  throw new Error(`Processing timeout after ${POLLING.TIMEOUT_MINUTES} minutes`);
}

export async function invalidateCache(contractId: string): Promise<void> {
  const token = getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(API_ENDPOINTS.CONTRACTS_CACHE(contractId), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to invalidate cache' }));
    throw new Error(error.error || 'Failed to invalidate cache');
  }
}
