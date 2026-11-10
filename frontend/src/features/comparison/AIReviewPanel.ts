import { diffStore, diffActions, pdfStore } from '@/store';
import { startAIComparison, stopAIComparison } from './comparisonV3';
import { locationLabel, type MappedAIFinding } from '@/services/diff/aiMapping';
import { escapeHtml } from '@/utils/html';
import { diffChars } from 'diff';

const kinds = { added:'新增', removed:'删除', modified:'修改', moved:'移动' };

function quotes(finding: MappedAIFinding, side: 'left' | 'right'): string {
  const before = finding.left.location.quote, after = finding.right.location.quote;
  if (!before && side === 'left' || !after && side === 'right') return '<span class="ai-muted">无对应原文</span>';
  if (finding.finding.category === 'format' || finding.finding.kind === 'moved') return escapeHtml(side === 'left' ? before : after);
  return diffChars(before,after).filter(p=>side === 'left' ? !p.added : !p.removed).map(p=>{
    const text = escapeHtml(p.value);
    return p.added || p.removed ? `<mark class="ai-word-${side}">${text}</mark>` : text;
  }).join('');
}

export class AIReviewPanel {
  private host: HTMLElement;
  private selectedDiff = -2;
  private comparisonId: string | null = null;
  constructor() {
    this.host = document.getElementById('ai-review')!;
    this.host.addEventListener('click', event=>{
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!target) return;
      if (target.dataset.action === 'retry') void startAIComparison();
      else if (target.dataset.action === 'stop') stopAIComparison();
      else if (target.dataset.action === 'visual') {
        const left = this.host.querySelector<HTMLSelectElement>('#visual-page-left');
        const right = this.host.querySelector<HTMLSelectElement>('#visual-page-right');
        if (left && right) void startAIComparison({left:Number(left.value),right:Number(right.value)});
      }
      else if (target.dataset.action === 'algorithm') {
        if (diffStore.getState().stats.total > 0) diffActions.goToDiff(0);
        else diffStore.setState({ currentDiffIndex: -1 });
      } else if (target.dataset.candidate !== undefined) {
        diffActions.selectAICandidate(target.dataset.finding!,target.dataset.side as 'left'|'right',Number(target.dataset.candidate),Number(target.dataset.diff));
      } else if (target.dataset.diff !== undefined) diffActions.goToDiff(Number(target.dataset.diff));
    });
    diffStore.subscribe((state, previous)=>{
      if (state.textDiffResult !== previous.textDiffResult || state.aiFindings !== previous.aiFindings || state.aiStatus !== previous.aiStatus || state.aiError !== previous.aiError || state.currentDiffIndex !== previous.currentDiffIndex || state.aiCandidates !== previous.aiCandidates) this.render();
    });
    pdfStore.subscribe((state,previous)=>{if(state.leftDoc!==previous.leftDoc || state.rightDoc!==previous.rightDoc) this.render();});
    this.render();
  }

  private render(): void {
    const state = diffStore.getState();
    this.host.hidden = !state.textDiffResult;
    if (!state.textDiffResult) { this.host.replaceChildren(); return; }
    const text = state.aiFindings.filter(f=>f.finding.category === 'text').length;
    const format = state.aiFindings.length-text;
    const pending = state.aiFindings.filter(f=>[f.left,f.right].some(s=>s.location.status === 'ambiguous' || s.location.status === 'unresolved')).length;
    const selected = state.aiFindings[state.currentDiffIndex-state.stats.total];
    const status = state.aiStatus === 'running' ? 'Luna medium 识别中，可先查看算法结果' : state.aiStatus === 'failed' ? 'AI 暂不可用' : state.aiStatus === 'partial' ? 'AI 部分完成' : state.aiStatus === 'completed' ? 'AI 识别完成' : '等待 AI 识别';
    const reviewed = state.aiJob?.visual_pages?.map(p=>`原件 ${p.left+1} / 修改件 ${p.right+1} 页`).join('、');
    const formatStatus = (state.aiJob?.format_status === 'completed' ? '已复核可唯一对应的 Word 段落的字符样式；其余格式与版式可进一步视觉复核。' : '整份文档的格式尚未完整复核。')+(reviewed?` 已视觉复核：${reviewed}。`:'');
    const previousScroll = this.host.querySelector('.ai-result-list')?.scrollTop ?? 0;
    const selectionChanged = state.currentDiffIndex !== this.selectedDiff || state.comparisonId !== this.comparisonId;
    const visualPage = (side:'left'|'right')=>Number((selectionChanged ? selected?.[side].candidates.flat()[0]?.pageIdx : undefined) ?? this.host.querySelector<HTMLSelectElement>(`#visual-page-${side}`)?.value ?? 0);
    const pages = {left:visualPage('left'),right:visualPage('right')};
    this.selectedDiff = state.currentDiffIndex; this.comparisonId = state.comparisonId;
    this.host.innerHTML = `
      <div class="ai-review-heading"><div><strong>AI 识别</strong> <span class="ai-state" role="status" aria-live="polite">${escapeHtml(status)}</span></div>
        <div class="ai-review-actions"><button class="btn btn-ghost btn-sm" data-action="algorithm" aria-pressed="${!selected}">算法结果 ${state.stats.total}</button>
        <button class="btn btn-ghost btn-sm" data-action="${state.aiStatus === 'running'?'stop':'retry'}">${state.aiStatus === 'running'?'停止等待':'重试 AI'}</button></div></div>
      <p class="ai-counts">文字 ${text} · 格式 ${format}${pending ? ` · 待确认 ${pending}` : ''}<span>算法与 AI 分别计数，AI 结果不覆盖算法结果</span></p>
      ${state.aiError ? `<p class="ai-notice" role="status">${escapeHtml(state.aiError)}</p>` : ''}
      <p class="ai-muted">${formatStatus}</p>
      ${state.aiJob?.warnings.length?`<details class="ai-muted"><summary>复核说明（${state.aiJob.warnings.length}）</summary>${state.aiJob.warnings.map(w=>`<p>${escapeHtml(w)}</p>`).join('')}</details>`:''}
      ${state.aiFindings.length ? `<div class="ai-review-body"><nav class="ai-result-list" aria-label="AI 识别项">${state.aiFindings.map((item,i)=>{
        const index = state.stats.total+i;
        return `<button class="ai-result-item${index === state.currentDiffIndex?' selected':''}" data-diff="${index}" aria-current="${index === state.currentDiffIndex?'true':'false'}"><span class="ai-item-label">AI ${i+1} · ${item.finding.category === 'format'?'格式':kinds[item.finding.kind]}</span><span>${escapeHtml(item.finding.summary)}</span><small>原件：${locationLabel(item.left)} · 修改件：${locationLabel(item.right)}</small></button>`;
      }).join('')}</nav><div class="ai-detail">${selected ? this.details(selected,state.currentDiffIndex) : '<p class="ai-empty">选择 AI 识别项，查看双侧引文并跳转到原件。当前显示算法高亮。</p>'}</div></div>` : `<p class="ai-empty">${state.aiStatus === 'running'?'算法结果已显示。AI 完成后，识别项会自动出现在这里。':state.aiStatus === 'completed'?'AI 未报告文字差异；请结合格式复核状态判断。':'算法结果仍可查看。'}</p>`}
      <div class="visual-review-controls"><span>视觉复核对应页面</span>${(['left','right'] as const).map(side=>{
        const doc = side === 'left'?pdfStore.getState().leftDoc:pdfStore.getState().rightDoc;
        return `<label>${side === 'left'?'原件':'修改件'} <select id="visual-page-${side}" aria-label="视觉复核${side === 'left'?'原件':'修改件'}页码">${Array.from({length:doc?.numPages ?? 0},(_,i)=>`<option value="${i}"${pages[side]===i?' selected':''}>第 ${i+1} 页</option>`).join('')}</select></label>`;
      }).join('')}<button class="btn btn-ghost btn-sm" data-action="visual"${!state.aiJob || state.aiStatus==='running' || !pdfStore.getState().leftDoc || !pdfStore.getState().rightDoc?' disabled':''}>复核这两页格式</button><span>仅判断选定页可对应条款的样式</span></div>`;
    const list = this.host.querySelector('.ai-result-list');
    if (list) {
      list.scrollTop = previousScroll;
      const selectedItem = list.querySelector<HTMLElement>('[aria-current="true"]');
      if (selectionChanged && selectedItem) {
        const bounds = selectedItem.getBoundingClientRect(), container = list.getBoundingClientRect();
        if (bounds.top < container.top) list.scrollTop -= container.top-bounds.top;
        else if (bounds.bottom > container.bottom) list.scrollTop += bounds.bottom-container.bottom;
      }
    }
    document.dispatchEvent(new CustomEvent('ai-panel-rendered'));
  }

  private details(item: MappedAIFinding, index: number): string {
    const state = diffStore.getState();
    const side = (name:'left'|'right')=>{
      const data = item[name];
      const selected = state.aiCandidates[`${item.finding.id}:${name}`];
      return `<section><div class="ai-quote-heading"><strong>${name === 'left'?'原件':'修改件'}</strong><span>${locationLabel(data)}</span></div><blockquote>${quotes(item,name)}</blockquote>
        ${data.location.reason?`<p class="ai-notice">${escapeHtml(data.location.reason)}</p>`:''}
        ${data.location.status === 'ambiguous'?`<div class="ai-candidates">${data.candidates.map((candidate,i)=>`<button class="btn btn-ghost btn-sm" data-finding="${escapeHtml(item.finding.id)}" data-side="${name}" data-candidate="${i}" data-diff="${index}" aria-pressed="${selected===i}">候选 ${String.fromCharCode(65+i)} · 第 ${(candidate[0]?.pageIdx ?? 0)+1} 页</button>`).join('')}</div>`:''}</section>`;
    };
    const refs = item.relatedAlgorithmIds;
    return `<p class="ai-detail-title">${escapeHtml(item.finding.summary)}</p><div class="ai-quote-grid">${side('left')}${side('right')}</div>
      <p class="ai-muted">${item.finding.source==='native_style'?'来源：Word 原生样式；框线标示正文区域。':item.finding.source==='vision'?'来源：原件图像视觉复核；样式框线标示正文区域。':'来源：Luna medium；扫描件的文字真伪请核对原件。'}${refs.length ? ` 引文范围涉及算法第 ${refs.map(i=>i+1).join('、')} 项。` : ''}</p>`;
  }
}
