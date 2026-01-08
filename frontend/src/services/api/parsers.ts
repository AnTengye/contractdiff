// Parsers API functions
import { API_ENDPOINTS } from '@/constants';
import { getToken } from '@/utils/auth';

export interface Parser {
  id: string;
  name: string;
  description?: string;
}

interface ParsersResponse {
  parsers: Parser[];
}

/**
 * Get available parsers
 */
export async function getParsers(): Promise<Parser[]> {
  const token = getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(API_ENDPOINTS.PARSERS, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    // Return empty array on error (parsers might not be configured)
    console.warn('Failed to fetch parsers');
    return [];
  }

  const data: ParsersResponse = await response.json();
  return data.parsers || [];
}
