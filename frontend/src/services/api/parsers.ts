// Parsers API functions
import { API_ENDPOINTS } from '@/constants';
import { getToken } from '@/utils/auth';

export interface Parser {
  id: string;
  name: string;
  description?: string;
}

// Backend response format from ParserCapabilities
interface BackendParser {
  type: string;
  name: string;
  description?: string;
  supported_formats?: string[];
  max_file_size?: number;
  features?: string[];
}

interface ParsersResponse {
  parsers: BackendParser[];
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
  // Map backend format (type) to frontend format (id)
  return (data.parsers || []).map((p) => ({
    id: p.type,
    name: p.name,
    description: p.description,
  }));
}
