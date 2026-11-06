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
  docx_available?: boolean;
}

export interface ParserCatalog {
  parsers: Parser[];
  docxAvailable: boolean;
}

/**
 * Get available parsers
 */
export async function getParsers(): Promise<ParserCatalog> {
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
    return { parsers: [], docxAvailable: false };
  }

  const data: ParsersResponse = await response.json();
  // Map backend format (type) to frontend format (id)
  return {
    parsers: (data.parsers || []).map((p) => ({
      id: p.type,
      name: p.name,
      description: p.description,
    })),
    docxAvailable: data.docx_available === true,
  };
}
