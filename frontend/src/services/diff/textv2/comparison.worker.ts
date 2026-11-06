import { computeTextDiffV2 } from './engine';
import type { ContractData } from './types';
import type { TextDiffEngineOptions } from './engine';
const workerScope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          left: ContractData;
          right: ContractData;
          options: TextDiffEngineOptions;
        }>
      ) => void)
    | null;
  postMessage: (value: unknown) => void;
};
workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({
      result: computeTextDiffV2(event.data.left, event.data.right, event.data.options),
    });
  } catch (error) {
    workerScope.postMessage({ error: error instanceof Error ? error.message : '比对失败' });
  }
};
