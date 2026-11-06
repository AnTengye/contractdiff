import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  uploadContract: vi.fn(),
  pollForResult: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('@/services/api', () => apiMocks);

import { handleFileUpload } from './handlers';
import { contractActions, contractStore } from '@/store';

afterEach(() => {
  contractActions.reset();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.stubGlobal('document', { getElementById: () => null });
  apiMocks.pollForResult.mockResolvedValue({
    data: { paragraphs: [{ text: 'current result' }] },
    pdfUrl: '/current.pdf',
  });
});

it('ignores an upload response that belongs to a cancelled older task', async () => {
  let resolveFirst!: (value: { id: string; status: 'pending' }) => void;
  let resolveSecond!: (value: { id: string; status: 'pending' }) => void;
  apiMocks.uploadContract
    .mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve))
    )
    .mockImplementationOnce(
      () => new Promise((resolve) => (resolveSecond = resolve))
    );

  const first = handleFileUpload({ name: 'first.pdf' } as File, 'left');
  await Promise.resolve();
  const second = handleFileUpload({ name: 'second.pdf' } as File, 'left');
  await Promise.resolve();

  resolveSecond({ id: 'contract-b', status: 'pending' });
  await second;
  resolveFirst({ id: 'contract-a', status: 'pending' });
  await first;

  expect(contractStore.getState().left.contractId).toBe('contract-b');
  expect(contractStore.getState().left.data).not.toBeNull();
});
