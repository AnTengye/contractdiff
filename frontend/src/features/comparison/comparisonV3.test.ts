import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contractActions, diffStore, pdfActions } from '@/store';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { computeTextDiffV2 } from '@/services/diff/textv2';
import { runComparisonV3, cancelComparison } from './comparisonV3';
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(): void {}
  terminate(): void {
    this.terminated = true;
  }
  finish(data: unknown): void {
    this.onmessage?.({ data });
  }
}
const data = { paragraphs: [{ text: '合同金额100元', page: 1 }] };
beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('document', { getElementById: () => null });
  vi.stubGlobal('localStorage', { getItem: () => null });
  FakeWorker.instances = [];
  contractActions.setData('left', data, 'left', '/left.pdf', 'pdf', 'left.pdf');
  contractActions.setData('right', data, 'right', '/right.pdf', 'pdf', 'right.pdf');
});
afterEach(() => {
  cancelComparison();
  pdfActions.reset();
  contractActions.reset();
  vi.unstubAllGlobals();
});
describe('worker comparison lifecycle', () => {
  it('rejects incomplete parser page coverage',async()=>{
    contractActions.setData('left',{...data,metadata:{page_count:1}},'left','/left.pdf','pdf','left.pdf');
    pdfActions.setLeftDoc({numPages:2} as PDFDocumentProxy);
    expect(await runComparisonV3()).toBeNull();expect(diffStore.getState().error).toContain('页数少于原件');expect(FakeWorker.instances).toHaveLength(0);
  });

  it('cancels pending work and rejects late results', async () => {
    const pending = runComparisonV3();
    const worker = FakeWorker.instances[0]!;
    expect(diffStore.getState().isComparing).toBe(true);
    cancelComparison();
    expect(await pending).toBeNull();
    worker.finish({ result: computeTextDiffV2(data, data) });
    expect(worker.terminated).toBe(true);
    expect(diffStore.getState().textDiffResult).toBeNull();
  });
  it('invalidates work when source documents are replaced', async () => {
    const pending = runComparisonV3();
    contractActions.resetSide('left');
    expect(await pending).toBeNull();
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
    expect(diffStore.getState().textDiffResult).toBeNull();
  });
  it('shows incomplete computation as an error rather than zero differences', async () => {
    const pending = runComparisonV3();
    FakeWorker.instances[0]!.finish({ error: '比对未完成' });
    expect(await pending).toBeNull();
    expect(diffStore.getState().error).toBe('比对未完成');
    expect(diffStore.getState().textDiffResult).toBeNull();
  });
  it('publishes a completed result with a comparison identity', async () => {
    const pending = runComparisonV3();
    FakeWorker.instances[0]!.finish({ result: computeTextDiffV2(data, data) });
    expect(await pending).not.toBeNull();
    expect(diffStore.getState().comparisonId).toBeTruthy();
    expect(diffStore.getState().isComparing).toBe(false);
  });
});
