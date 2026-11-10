import { getToken } from '@/utils/auth';

export interface AIUnit {
  id: string;
  index: number;
  page_idx: number;
  block_idx: number;
  text: string;
  kind: string;
  structure?: string;
}
export interface AILocation {
  status: 'verified' | 'ambiguous' | 'unresolved' | 'not_applicable';
  quote: string;
  reason?: string;
  candidates: Array<{ ranges: Array<{ unit_index: number; unit_id: string; start: number; end: number }> }> | null;
}
export interface AIFinding {
  id: string;
  category: 'text' | 'format';
  kind: 'added' | 'removed' | 'modified' | 'moved';
  summary: string;
  before: AILocation;
  after: AILocation;
  source: 'ai' | 'native_style' | 'vision';
}
export interface AIJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
  phase: string;
  model: string;
  reasoning: string;
  documents: Record<'left' | 'right', { pdf_hash: string; result_signature: string; units: AIUnit[] }>;
  findings: AIFinding[];
  format_status: 'completed' | 'unavailable' | 'partial';
  visual_pages?: Array<{left:number;right:number}>;
  warnings: string[];
  error?: string;
}
export interface AIRequest {
  left_id: string;
  right_id: string;
  options: { ignore_whitespace: boolean; ignore_punctuation: boolean; ignore_headers: boolean };
  candidates: Array<{ before: string; after: string }>;
}

async function request(path: string, signal: AbortSignal, body?: unknown): Promise<AIJob> {
  const token = getToken();
  if (!token) throw new Error('登录已失效，算法结果仍可使用');
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(value?.error ?? 'AI 服务暂时不可用，算法结果仍可使用');
  if (!value || !Array.isArray(value.findings) || !value.documents?.left || !value.documents?.right)
    throw new Error('AI 响应不可读取，算法结果仍可使用');
  return value as AIJob;
}
export const aiDiffAPI = {
  create: (body: AIRequest, signal: AbortSignal) => request('/api/ai-diff', signal, body),
  get: (id: string, signal: AbortSignal) => request(`/api/ai-diff/${encodeURIComponent(id)}`, signal),
  visual: (id: string, body: {left:{page_idx:number;data_url:string};right:{page_idx:number;data_url:string}}, signal: AbortSignal) => request(`/api/ai-diff/${encodeURIComponent(id)}/visual`,signal,body),
};
