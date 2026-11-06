import { contractStore, diffStore, diffActions, pdfActions, pdfStore, uiActions } from '@/store';
import { DIFF_ENGINE_VERSION, BUILD_REVISION } from '@/services/diff/textv2/version';
import type { TextDiffResultV2, ContractData } from '@/services/diff/textv2';
let activeWorker: Worker | null = null;
let cancelPending: (() => void) | null = null;
let generation = 0;

export function cancelComparison(): void {
  generation++;
  activeWorker?.terminate();
  activeWorker = null;
  cancelPending?.();
  cancelPending = null;
  diffActions.setComparing(false);
}
export async function runComparisonV3(): Promise<TextDiffResultV2 | null> {
  cancelComparison();
  const state = contractStore.getState();
  if (!state.left.data || !state.right.data) return null;
  const run = ++generation;
  diffActions.reset();
  diffActions.setComparing(true);
  const ignoreWhitespace =
    (document.getElementById('ignore-whitespace') as HTMLInputElement | null)?.checked ?? true;
  const ignorePunctuation =
    (document.getElementById('ignore-punctuation') as HTMLInputElement | null)?.checked ?? false;
  const ignoreHeaders =
    (document.getElementById('ignore-headers') as HTMLInputElement | null)?.checked ?? false;
  diffActions.setContext({
    engineVersion: DIFF_ENGINE_VERSION,
    buildRevision: BUILD_REVISION,
    options: {
      charLevel: true,
      ignoreWhitespace,
      ignorePunctuation,
      ignoreHeaders,
      timeoutMs: 10000,
    },
  });
  for (const side of ['left', 'right'] as const) {
    const doc = side === 'left' ? pdfStore.getState().leftDoc : pdfStore.getState().rightDoc;
    const count =
      state[side].data?.metadata?.parser_page_count ?? state[side].data?.metadata?.page_count;
    if (doc && typeof count === 'number' && count < doc.numPages) {
      diffActions.setError('解析结果页数少于原件，本次比对未完成，请重新解析或反馈遗漏页。');
      return null;
    }
  }
  try {
    const worker = new Worker(
      new URL('../../services/diff/textv2/comparison.worker.ts', import.meta.url),
      { type: 'module' }
    );
    activeWorker = worker;
    const result = await new Promise<TextDiffResultV2 | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('计算达到上限，本次比对未完成，请缩小文档范围后重试。'));
      }, 15000);
      cancelPending = () => {
        clearTimeout(timeout);
        resolve(null);
      };
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('比对计算未完成，请重试或提交反馈。'));
      };
      worker.postMessage({
        left: state.left.data as unknown as ContractData,
        right: state.right.data as unknown as ContractData,
        options: {
          charLevel: true,
          ignoreWhitespace,
          ignorePunctuation,
          ignoreHeaders,
          timeoutMs: 10000,
          debug: false,
        },
      });
    });
    if (!result || run !== generation) return null;
    diffActions.setTextDiffResult(result);
    uiActions.showResults();
    return result;
  } catch (error) {
    if (run === generation)
      diffActions.setError(error instanceof Error ? error.message : '比对未完成');
    return null;
  } finally {
    if (run === generation) {
      activeWorker?.terminate();
      activeWorker = null;
      cancelPending = null;
      diffActions.setComparing(false);
    }
  }
}
contractStore.subscribe((state, previous) => {
  if (
    state.left.data !== previous.left.data ||
    state.right.data !== previous.right.data ||
    (state.left.isUploading && !previous.left.isUploading) ||
    (state.right.isUploading && !previous.right.isUploading)
  ) {
    cancelComparison();
    diffActions.reset();
  }
});
export function getComparisonResultV3(): TextDiffResultV2 | null {
  return diffStore.getState().textDiffResult;
}
export function resetComparisonV3(): void {
  cancelComparison();
  diffActions.reset();
  pdfActions.reset();
  uiActions.hideResults();
}
