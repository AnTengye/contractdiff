import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contractActions, diffStore, diffActions } from '@/store';
import { computeTextDiffV2 } from '@/services/diff/textv2';
import { runComparisonV3, cancelComparison } from './comparisonV3';
import { aiDiffAPI, type AIJob } from '@/services/api/aiDiff';

vi.mock('@/services/api/aiDiff',()=>({aiDiffAPI:{create:vi.fn(),get:vi.fn()}}));
class WorkerStub {
  static instance: WorkerStub;
  onmessage: ((e:{data:unknown})=>void)|null=null;
  onerror: (()=>void)|null=null;
  constructor(){WorkerStub.instance=this;}
  postMessage():void {}
  terminate():void {}
}
const data={paragraphs:[{text:'金额100.00元',page:1}]};
let finishAI: (job:AIJob)=>void;
beforeEach(()=>{
  vi.stubGlobal('Worker',WorkerStub);vi.stubGlobal('document',{getElementById:()=>null});
  contractActions.setData('left',data,'L','/l.pdf','pdf','l.pdf');
  contractActions.setData('right',data,'R','/r.pdf','pdf','r.pdf');
  vi.mocked(aiDiffAPI.create).mockImplementation(()=>new Promise(resolve=>{finishAI=resolve;}));
});
afterEach(()=>{cancelComparison();contractActions.reset();diffActions.reset();vi.unstubAllGlobals();vi.clearAllMocks();});
function completed(): AIJob {return {id:'job',status:'completed',phase:'done',model:'gpt-6-luna',reasoning:'medium',documents:{left:{pdf_hash:'',result_signature:'',units:[]},right:{pdf_hash:'',result_signature:'',units:[]}},findings:[],format_status:'unavailable',warnings:[]};}
describe('algorithm-first asynchronous AI lifecycle',()=>{
  it('returns the algorithm immediately while AI is pending, then publishes AI',async()=>{
    const pending=runComparisonV3(),result=computeTextDiffV2(data,data);
    WorkerStub.instance.onmessage!({data:{result}});
    expect(await pending).toBe(result);
    expect(diffStore.getState().textDiffResult).toBe(result);
    expect(diffStore.getState().aiStatus).toBe('running');
    expect(diffStore.getState().isComparing).toBe(false);
    const request=vi.mocked(aiDiffAPI.create).mock.calls[0]![0];
    expect(request.options.ignore_punctuation).toBe(false);
    finishAI(completed());
    await vi.waitFor(()=>expect(diffStore.getState().aiStatus).toBe('completed'));
  });
  it('keeps algorithm output on API failure',async()=>{
    vi.mocked(aiDiffAPI.create).mockRejectedValueOnce(new Error('HTTP 503'));
    const pending=runComparisonV3(),result=computeTextDiffV2(data,data);
    WorkerStub.instance.onmessage!({data:{result}});await pending;
    await vi.waitFor(()=>expect(diffStore.getState().aiStatus).toBe('failed'));
    expect(diffStore.getState().textDiffResult).toBe(result);
    expect(diffStore.getState().comparisonId).toBeTruthy();
    expect(diffStore.getState().error).toBeNull();
  });
  it('rejects late AI after switching documents',async()=>{
    const pending=runComparisonV3(),result=computeTextDiffV2(data,data);
    WorkerStub.instance.onmessage!({data:{result}});await pending;
    contractActions.resetSide('left');finishAI(completed());
    await Promise.resolve();await Promise.resolve();
    expect(diffStore.getState().textDiffResult).toBeNull();
    expect(diffStore.getState().aiJob).toBeNull();
    expect(diffStore.getState().aiStatus).toBe('idle');
  });
});
