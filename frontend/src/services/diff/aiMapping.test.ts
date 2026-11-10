import { describe, expect, it } from 'vitest';
import { mapAIFindings, locationLabel } from './aiMapping';
import { computeTextDiffV2, type ContractData } from './textv2';
import type { AIJob, AILocation } from '@/services/api/aiDiff';
import { displaySegments } from './display';
import { diffActions, diffStore } from '@/store';

const left: ContractData = {metadata:{pdf_hash:'left-pdf'},paragraphs:[{page:3,text:'日期：____ 日期：____',bbox:[20,100,300,130]}]};
const right: ContractData = {metadata:{pdf_hash:'right-pdf'},paragraphs:[{page:7,text:'日期：2026年11月6日',bbox:[400,600,800,640]}]};
function job(): AIJob {
  const before: AILocation = {status:'ambiguous',quote:'日期：____',candidates:[{ranges:[{unit_index:0,unit_id:'L',start:0,end:7}]},{ranges:[{unit_index:0,unit_id:'L',start:8,end:15}]}]};
  return {id:'j',status:'completed',phase:'done',model:'gpt-6-luna',reasoning:'medium',format_status:'unavailable',warnings:[],documents:{
    left:{pdf_hash:'left-pdf',result_signature:'',units:[{id:'L',index:0,page_idx:2,block_idx:0,text:'日期：____ 日期：____',kind:'text'}]},
    right:{pdf_hash:'right-pdf',result_signature:'',units:[{id:'R',index:0,page_idx:6,block_idx:0,text:'日期：2026年11月6日',kind:'text'}]},
  },findings:[{id:'f',kind:'modified',category:'text',source:'ai',summary:'日期填写',before,after:{status:'verified',quote:'日期：2026年11月6日',candidates:[{ranges:[{unit_index:0,unit_id:'R',start:0,end:13}]}]}}]};
}
describe('AI source geometry and candidate navigation',()=>{
  it('keeps repeated occurrences and independent PDF page geometry',()=>{
    const result=computeTextDiffV2(left,right);
    const mapped=mapAIFindings(job(),result,left,right);
    expect(mapped[0]!.left.candidates).toHaveLength(2);
    expect(locationLabel(mapped[0]!.left)).toBe('2 个候选位置');
    expect(locationLabel(mapped[0]!.right)).toBe('区域定位');
    expect(mapped[0]!.left.candidates[0]![0]!.pageIdx).toBe(2);
    expect(mapped[0]!.right.candidates[0]![0]!.pageIdx).toBe(6);
    expect(mapped[0]!.right.candidates[0]![0]!.bbox).toEqual([400,600,800,640]);
    // Coarse source geometry is never split into invented character boxes.
    expect(mapped[0]!.right.candidates[0]![0]!.precision).toBe('block');
  });
  it('discards references from a different PDF or normalized unit',()=>{
    const result=computeTextDiffV2(left,right),response=job();
    response.documents.left.pdf_hash='other';response.documents.right.units[0]!.text='伪造引文';
    const item=mapAIFindings(response,result,left,right)[0]!;
    expect(item.left.location.status).toBe('unresolved');expect(item.left.candidates).toEqual([]);
    expect(item.right.location.status).toBe('unresolved');expect(item.right.candidates).toEqual([]);
  });
  it('keeps algorithm results when AI is selected and handles no-counterpart sides',()=>{
    const result=computeTextDiffV2(left,right),response=job();
    response.findings[0]!.kind='added';response.findings[0]!.before={status:'not_applicable',quote:'',candidates:[]};
    diffActions.reset();diffActions.setTextDiffResult(result);
    diffActions.setAIJob(response,mapAIFindings(response,result,left,right));
    diffActions.goToDiff(result.stats.totalChanges);
    expect(displaySegments(diffStore.getState(),'left')).toEqual([]);
    expect(displaySegments(diffStore.getState(),'right').length).toBeGreaterThan(0);
    expect(diffStore.getState().textDiffResult).toBe(result);
    diffActions.setAIStatus('failed','unavailable');
    expect(diffStore.getState().textDiffResult).toBe(result);
    diffActions.reset();
  });
});
