import { contractStore, diffStore, diffActions, pdfActions, pdfStore, uiActions } from '@/store';
import { DIFF_ENGINE_VERSION, BUILD_REVISION } from '@/services/diff/textv2/version';
import type { TextDiffResultV2, ContractData } from '@/services/diff/textv2';
import { aiDiffAPI, type AIJob } from '@/services/api/aiDiff';
import { mapAIFindings } from '@/services/diff/aiMapping';
let activeWorker: Worker | null = null;
let aiController: AbortController | null = null;
let cancelPending: (() => void) | null = null;
let generation = 0;

export function cancelComparison(): void {
  generation++;
  stopAIComparison();
  activeWorker?.terminate();
  activeWorker = null;
  cancelPending?.();
  cancelPending = null;
  diffActions.setComparing(false);
}

export function stopAIComparison(): void {
  if (aiController) {
    aiController.abort();
    aiController = null;
    diffActions.setAIStatus('partial', '已停止等待 AI，算法结果仍可使用');
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject)=>{
    if (signal.aborted) { reject(new DOMException('Aborted','AbortError')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted','AbortError')); };
    const timer = setTimeout(()=>{ signal.removeEventListener('abort', onAbort); resolve(); },ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function startAIComparison(visualPages?: {left:number;right:number}): Promise<void> {
  stopAIComparison();
  const run = generation;
  const state = contractStore.getState(), comparison = diffStore.getState();
  const result = comparison.textDiffResult, comparisonId = comparison.comparisonId;
  if (!result || !state.left.contractId || !state.right.contractId || !state.left.data || !state.right.data) return;
  const controller = new AbortController();
  aiController = controller;
  diffActions.setAIStatus('running');
  const current = () => !controller.signal.aborted && run === generation && diffStore.getState().comparisonId === comparisonId;
  const timeout = setTimeout(()=>controller.abort('timeout'), 225000);
  try {
    const options = result.metadata?.options ?? {};
    const candidates = result.changes.filter(c=>c.type !== 'unchanged').slice(0,200).map(c=>({
      before: c.leftStartOffset === undefined ? '' : result.left.fullText.slice(c.leftStartOffset,c.leftEndOffset),
      after: c.rightStartOffset === undefined ? '' : result.right.fullText.slice(c.rightStartOffset,c.rightEndOffset),
    }));
    let job: AIJob;
    if (visualPages && comparison.aiJob) {
      const image = async (side:'left'|'right')=>{
        const doc = side === 'left' ? pdfStore.getState().leftDoc : pdfStore.getState().rightDoc;
        if (!doc) throw new Error('原件仍在加载，请稍后重试');
        const page = await doc.getPage(visualPages[side]+1);
        const viewport = page.getViewport({scale:1});
        const scaled = page.getViewport({scale:Math.min(2,1440/viewport.width)});
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(scaled.width); canvas.height = Math.ceil(scaled.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法读取原件页面图像');
        await page.render({canvasContext:context,viewport:scaled}).promise;
        const data_url = canvas.toDataURL('image/jpeg',.9);
        canvas.width = 0; canvas.height = 0;
        return {page_idx:visualPages[side],data_url};
      };
      const left = await image('left'), right = await image('right');
      if (!current()) return;
      job = await aiDiffAPI.visual(comparison.aiJob.id,{left,right},controller.signal);
    } else job = await aiDiffAPI.create({
      left_id: state.left.contractId, right_id: state.right.contractId,
      options: { ignore_whitespace: options.ignoreWhitespace !== false, ignore_punctuation: options.ignorePunctuation === true, ignore_headers: options.ignoreHeaders === true },
      candidates,
    }, controller.signal);
    let fingerprint = '';
    while (current()) {
      const nextFingerprint = JSON.stringify([job.status,job.findings,job.format_status,job.error]);
      if (nextFingerprint !== fingerprint) {
        const mapped = mapAIFindings(job, result, state.left.data as unknown as ContractData, state.right.data as unknown as ContractData);
        if (!current()) return;
        diffActions.setAIJob(job,mapped);
        fingerprint = nextFingerprint;
      }
      if (job.status !== 'running' && job.status !== 'queued') break;
      await pause(3000,controller.signal);
      job = await aiDiffAPI.get(job.id,controller.signal);
    }
  } catch (error) {
    if (run === generation && diffStore.getState().comparisonId === comparisonId && (!controller.signal.aborted || controller.signal.reason === 'timeout'))
      diffActions.setAIStatus('failed', controller.signal.reason === 'timeout' ? 'AI 等待超时，算法结果仍可使用' : error instanceof Error ? error.message : 'AI 服务暂时不可用，算法结果仍可使用');
  } finally {
    clearTimeout(timeout);
    if (aiController === controller) aiController = null;
  }
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
    void startAIComparison();
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
