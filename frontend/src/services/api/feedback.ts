import { getToken } from '@/utils/auth';
export interface FeedbackRegion {
  side: 'left' | 'right';
  page: number;
  bbox?: number[];
  text?: string;
}
export interface RegressionExpectation {
  total_changes?: number;
  left_text?: string;
  right_text?: string;
}
export interface FeedbackCase {
  id: string;
  category: string;
  description: string;
  expected: string;
  status: string;
  revision: number;
  reporter: string;
  created_at: string;
  left_id?: string;
  right_id?: string;
  region?: FeedbackRegion;
  resolution_version?: string;
  regression?: RegressionExpectation;
  events?: Array<{ actor: string; status: string; note: string; created_at: string }>;
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/feedback${path}`, {
    method,
    headers: { Authorization: `Bearer ${getToken() ?? ''}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('反馈服务返回格式错误');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '反馈操作失败');
  return result as T;
}
export const feedbackAPI = {
  create: (body: unknown) => request<FeedbackCase>('', 'POST', body),
  list: () => request<{ feedback: FeedbackCase[] }>(''),
  get: (id: string) => request<FeedbackCase>(`/${encodeURIComponent(id)}`),
  update: (id: string, body: unknown) =>
    request<FeedbackCase>(`/${encodeURIComponent(id)}`, 'PUT', body),
  async download(id: string, artifact: string): Promise<void> {
    const path = artifact === 'regression' ? `/${id}/regression` : `/${id}/artifacts/${artifact}`;
    const response = await fetch(`/api/feedback${path}`, {
      headers: { Authorization: `Bearer ${getToken() ?? ''}` },
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error ?? '下载失败');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download =
      response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ??
      `feedback-${id}-${artifact}${artifact === 'regression' || artifact === 'snapshot' ? '.json' : artifact.endsWith('pdf') ? '.pdf' : ''}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
