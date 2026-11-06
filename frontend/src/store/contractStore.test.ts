import { afterEach, expect, it } from 'vitest';
import { contractActions, contractStore } from './contractStore';

afterEach(() => contractActions.reset());

it('cancels the previous upload and does not clear a replacement token', () => {
  const first = { cancelled: false };
  const second = { cancelled: false };
  contractActions.setCancelToken('left', first);
  contractActions.setCancelToken('left', second);
  expect(first.cancelled).toBe(true);
  expect(contractStore.getState().cancelTokens.left).toBe(second);

  contractActions.clearCancelToken('left', first);
  expect(contractStore.getState().cancelTokens.left).toBe(second);
  contractActions.clearCancelToken('left', second);
  expect(contractStore.getState().cancelTokens.left).toBeNull();
});
