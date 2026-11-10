import { contractStore, diffStore, pdfStore } from '@/store';
import {
  feedbackAPI,
  type FeedbackCase,
  type FeedbackRegion,
  type RegressionExpectation,
} from '@/services/api/feedback';
import { escapeHtml } from '@/utils/html';
import { displaySegments } from '@/services/diff/display';
const categories: Record<string, string> = {
  missed: '漏报差异',
  false_positive: '误报差异',
  ocr: '文字识别错误',
  table: '表格遗漏或结构错误',
  highlight: '高亮位置偏移',
  performance: '处理过慢',
  failure: '处理失败',
};
const statuses: Record<string, string> = {
  new: '待分析',
  reproduced: '已复现',
  diagnosed: '已归因',
  fixed: '已修复',
  verified: '已验证',
  closed: '已关闭',
};
const transitions: Record<string, string[]> = {
  new: ['new', 'reproduced', 'closed'],
  reproduced: ['reproduced', 'diagnosed', 'closed'],
  diagnosed: ['diagnosed', 'fixed', 'closed'],
  fixed: ['fixed', 'verified', 'diagnosed'],
  verified: ['verified', 'diagnosed'],
  closed: ['closed', 'reproduced'],
};

export class FeedbackPanel {
  private createDialog: HTMLDialogElement;
  private historyDialog: HTMLDialogElement;
  private region: FeedbackRegion | undefined;
  private selected: FeedbackCase | null = null;
  private picking = false;
  private pickCleanup: (() => void) | null = null;
  private comparison: unknown;
  private context: { left_id?: string; right_id?: string; comparison_id?: string } = {};
  constructor(private canReview: boolean) {
    const host = document.createElement('div');
    host.innerHTML = `
      <dialog id="feedback-dialog" class="feedback-dialog" aria-labelledby="feedback-title"><form id="feedback-form">
      <div class="feedback-heading"><h2 id="feedback-title">反馈比对问题</h2><button type="button" data-close aria-label="关闭反馈">×</button></div>
      <p>会保存当前文档、解析结果及比对上下文，以便复现和跟进。</p>
      <label>问题类型<select name="category" required>${Object.entries(categories)
        .map(([v, t]) => `<option value="${v}">${t}</option>`)
        .join('')}</select></label>
      <div class="feedback-location"><label>位置<select name="side"><option value="">整个比对</option><option value="left">原件</option><option value="right">修改件</option></select></label><label>页码<input name="page" type="number" min="1" value="1"></label></div>
      <p id="feedback-region-info"></p>
      <label>问题说明<textarea name="description" required maxlength="8000" rows="3" placeholder="哪处结果不符合原文或预期？"></textarea></label>
      <label>预期结果（选填）<textarea name="expected" maxlength="8000" rows="2" placeholder="例如：这里应当提示金额发生变化"></textarea></label>
      <p id="feedback-form-message" role="status" aria-live="polite"></p>
      <div class="feedback-actions"><button type="button" class="btn btn-ghost" data-close>取消</button><button type="submit" class="btn btn-primary">提交反馈</button></div>
      </form></dialog>
      <dialog id="feedback-history" class="feedback-dialog feedback-history" aria-labelledby="feedback-history-title">
      <div class="feedback-heading"><h2 id="feedback-history-title">${canReview ? '反馈案例与分析' : '我的反馈'}</h2><button type="button" data-close aria-label="关闭反馈记录">×</button></div>
      <p id="feedback-history-message" role="status" aria-live="polite"></p><div id="feedback-case-list"></div><div id="feedback-case-detail"></div></dialog>`;
    document.body.appendChild(host);
    this.createDialog = host.querySelector('#feedback-dialog')!;
    this.historyDialog = host.querySelector('#feedback-history')!;
    host
      .querySelectorAll<HTMLButtonElement>('[data-close]')
      .forEach((button) =>
        button.addEventListener('click', () => button.closest('dialog')?.close())
      );
    document.getElementById('feedback-btn')?.addEventListener('click', () => this.openCreate());
    document
      .getElementById('feedback-history-btn')
      ?.addEventListener('click', () => void this.openHistory());
    document.getElementById('feedback-region-btn')?.addEventListener('click', () => {
      this.picking = !this.picking;
      document.body.classList.toggle('feedback-picking', this.picking);
      this.status(
        this.picking ? '在原件或修改件上拖动框选问题区域；按 Esc 取消。' : '已取消框选。'
      );
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.picking) this.stopPicking();
    });
    document.addEventListener('pointerdown', (event) => void this.pickRegion(event));
    document.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-feedback-diff]');
      if (button)
        this.openDiff(
          Number(button.dataset.feedbackDiff),
          button.dataset.feedbackSide as 'left' | 'right'
        );
    });
    document.addEventListener('feedback-diff', (event) => {
      const detail = (event as CustomEvent<{ diffId: number; side: 'left' | 'right' }>).detail;
      this.openDiff(detail.diffId, detail.side);
    });
    host.querySelector('#feedback-form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    host.querySelector('#feedback-case-list')!.addEventListener('click', (event) => {
      const id = (event.target as HTMLElement).closest<HTMLElement>('[data-case-id]')?.dataset
        .caseId;
      if (id) void this.showCase(id);
    });
    host.querySelector('#feedback-case-detail')!.addEventListener('click', (event) => {
      const kind = (event.target as HTMLElement).closest<HTMLElement>('[data-artifact]')?.dataset
        .artifact;
      if (kind && this.selected)
        void feedbackAPI
          .download(this.selected.id, kind)
          .catch((error) => this.historyMessage(error.message));
    });
    host.querySelector('#feedback-case-detail')!.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.updateCase(event.target as HTMLFormElement);
    });
    const update = () => {
      this.stopPicking();
      const state = contractStore.getState();
      const disabled = !state.left.contractId && !state.right.contractId;
      const button = document.getElementById('feedback-btn') as HTMLButtonElement | null;
      if (button) button.disabled = disabled;
    };
    contractStore.subscribe(update);
    update();
  }
  private status(message: string): void {
    const el = document.getElementById('comparison-status');
    if (el) el.textContent = message;
  }
  private stopPicking(): void {
    this.pickCleanup?.();
    this.pickCleanup = null;
    this.picking = false;
    document.body.classList.remove('feedback-picking');
  }
  private openDiff(diffId: number, side: 'left' | 'right'): void {
    const segment = displaySegments(diffStore.getState(),side).find(
      (s) => s.diffId === diffId
    );
    if (segment)
      this.openCreate({ side, page: segment.pageIdx + 1, bbox: segment.bbox, text: segment.text });
  }
  private openCreate(region?: FeedbackRegion): void {
    const state = contractStore.getState(),
      diff = diffStore.getState();
    if (!state.left.contractId && !state.right.contractId) {
      this.status('请先上传一份文档，再提交反馈。');
      return;
    }
    this.region = region;
    this.context = {
      left_id: state.left.contractId ?? undefined,
      right_id: state.right.contractId ?? undefined,
      comparison_id: diff.comparisonId ?? undefined,
    };
    const result = diff.textDiffResult;
    this.comparison = result
      ? {
          metadata: result.metadata,
          stats: result.stats,
          sourcePageCounts: {
            left: pdfStore.getState().leftDoc?.numPages,
            right: pdfStore.getState().rightDoc?.numPages,
          },
          changes: result.changes,
          ai: diff.aiJob ? { jobId:diff.aiJob.id,status:diff.aiStatus,model:diff.aiJob.model,reasoning:diff.aiJob.reasoning,findings:diff.aiJob.findings,selectedCandidates:diff.aiCandidates } : {status:diff.aiStatus,error:diff.aiError},
        }
      : { metadata: diff.context, error: diff.error };
    const form = this.createDialog.querySelector('form')!;
    form.reset();
    (form.elements.namedItem('side') as HTMLSelectElement).value = region?.side ?? '';
    (form.elements.namedItem('page') as HTMLInputElement).value = String(region?.page ?? 1);
    this.createDialog.querySelector('#feedback-region-info')!.textContent = region?.bbox
      ? '已关联框选或高亮区域。'
      : '';
    this.createDialog.querySelector('#feedback-form-message')!.textContent = '';
    this.createDialog.showModal();
    (form.elements.namedItem('description') as HTMLTextAreaElement).focus();
  }
  private async submit(): Promise<void> {
    const form = this.createDialog.querySelector('form')!,
      data = new FormData(form);
    const message = this.createDialog.querySelector('#feedback-form-message')!;
    const button = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    const side = String(data.get('side'));
    let region: FeedbackRegion | undefined;
    if (side === 'left' || side === 'right') {
      const page = Number(data.get('page'));
      region = { side, page };
      if (this.region?.side === side && this.region.page === page) region = this.region;
    }
    button.disabled = true;
    try {
      const result = await feedbackAPI.create({
        ...this.context,
        category: data.get('category'),
        description: data.get('description'),
        expected: data.get('expected'),
        comparison: this.comparison,
        region,
      });
      this.createDialog.close();
      this.status(`反馈已记录，编号 ${result.id.slice(0, 8)}；可在反馈记录中查看处理进展。`);
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : '提交失败';
    } finally {
      button.disabled = false;
    }
  }
  private historyMessage(message: string): void {
    this.historyDialog.querySelector('#feedback-history-message')!.textContent = message;
  }
  private async openHistory(): Promise<void> {
    if (!this.historyDialog.open) this.historyDialog.showModal();
    this.historyMessage('读取反馈记录…');
    try {
      const { feedback } = await feedbackAPI.list();
      this.historyDialog.querySelector('#feedback-case-list')!.innerHTML = feedback
        .map(
          (f) =>
            `<button type="button" class="feedback-case" data-case-id="${escapeHtml(f.id)}"><strong>${escapeHtml(categories[f.category] ?? f.category)} · ${escapeHtml(statuses[f.status] ?? f.status)}</strong><span>${escapeHtml(f.description.slice(0, 100))}</span><small>${escapeHtml(f.id.slice(0, 8))} · ${escapeHtml(new Date(f.created_at).toLocaleString())}</small></button>`
        )
        .join('');
      this.historyMessage(feedback.length ? '显示最近 200 条反馈。' : '还没有反馈记录。');
    } catch (error) {
      this.historyMessage(error instanceof Error ? error.message : '读取失败');
    }
  }
  private async showCase(id: string): Promise<void> {
    try {
      const f = await feedbackAPI.get(id);
      this.selected = f;
      this.historyDialog.querySelector('#feedback-case-detail')!.innerHTML =
        `<hr><h3>${escapeHtml(categories[f.category] ?? f.category)} · ${escapeHtml(statuses[f.status] ?? f.status)}</h3><p>${escapeHtml(f.description)}</p><p>预期：${escapeHtml(f.expected || '未填写')}</p><p>编号：${escapeHtml(f.id)}</p>
      <div class="feedback-actions">${['snapshot', ...(f.left_id ? ['left_original', 'left_pdf'] : []), ...(f.right_id ? ['right_original', 'right_pdf'] : [])].map((kind) => `<button type="button" class="btn btn-ghost" data-artifact="${kind}">${({ snapshot: '复现快照', left_original: '原件文件', left_pdf: '原件 PDF', right_original: '修改件文件', right_pdf: '修改件 PDF' } as Record<string, string>)[kind]}</button>`).join('')}${this.canReview && f.status === 'verified' ? '<button type="button" class="btn btn-ghost" data-artifact="regression">导出回归样例</button>' : ''}</div>
      <ol class="feedback-events">${(f.events ?? []).map((e) => `<li><strong>${escapeHtml(statuses[e.status] ?? e.status)} · ${escapeHtml(e.actor)}</strong><p>${escapeHtml(e.note)}</p><small>${escapeHtml(new Date(e.created_at).toLocaleString())}</small></li>`).join('')}</ol>
      ${this.canReview ? `<form id="feedback-review-form"><label>处理状态<select name="status">${(transitions[f.status] ?? []).map((s) => `<option value="${s}">${statuses[s]}</option>`).join('')}</select></label><label>复现、归因或验证记录<textarea name="note" rows="3" required maxlength="8000"></textarea></label><label>修复版本（标记已修复时必填）<input name="version" maxlength="128" value="${escapeHtml(f.resolution_version ?? '')}"></label><fieldset><legend>回归预期（标记已验证时至少填写一项）</legend><label>预期差异数<input name="total" type="number" min="0" value="${f.regression?.total_changes ?? ''}"></label><label>原件应包含的文本<input name="left" value="${escapeHtml(f.regression?.left_text ?? '')}"></label><label>修改件应包含的文本<input name="right" value="${escapeHtml(f.regression?.right_text ?? '')}"></label></fieldset><button type="submit" class="btn btn-primary">保存处理记录</button></form>` : ''}`;
    } catch (error) {
      this.historyMessage(error instanceof Error ? error.message : '读取失败');
    }
  }
  private async updateCase(form: HTMLFormElement): Promise<void> {
    if (!this.selected) return;
    const data = new FormData(form),
      regression: RegressionExpectation = {};
    if (String(data.get('total')).trim() !== '')
      regression.total_changes = Number(data.get('total'));
    if (data.get('left')) regression.left_text = String(data.get('left'));
    if (data.get('right')) regression.right_text = String(data.get('right'));
    const button = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    button.disabled = true;
    try {
      const f = await feedbackAPI.update(this.selected.id, {
        status: data.get('status'),
        note: data.get('note'),
        revision: this.selected.revision,
        resolution_version: data.get('version'),
        regression: Object.keys(regression).length ? regression : undefined,
      });
      await this.openHistory();
      await this.showCase(f.id);
      this.historyMessage('处理记录已保存。');
    } catch (error) {
      this.historyMessage(error instanceof Error ? error.message : '保存失败');
      button.disabled = false;
    }
  }
  private async pickRegion(event: PointerEvent): Promise<void> {
    if (!this.picking || event.button !== 0) return;
    const wrapper = (event.target as HTMLElement).closest<HTMLElement>('.pdf-page-wrapper');
    if (!wrapper || wrapper.dataset.rendered !== 'true') return;
    const side = wrapper.closest('#pdf-pages-left') ? 'left' : 'right',
      page = Number(wrapper.dataset.pageNum),
      bounds = wrapper.getBoundingClientRect();
    const contractId = contractStore.getState()[side].contractId;
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    const svg = wrapper.querySelector('svg')!;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'feedback-selection');
    svg.appendChild(rect);
    try {
      wrapper.setPointerCapture(event.pointerId);
    } catch {
      // Document listeners still complete the selection when capture is unavailable.
    }
    event.preventDefault();
    let lastX = x,
      lastY = y;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      lastX = Math.max(0, Math.min(bounds.width, e.clientX - bounds.left));
      lastY = Math.max(0, Math.min(bounds.height, e.clientY - bounds.top));
      rect.setAttribute('x', String(Math.min(x, lastX)));
      rect.setAttribute('y', String(Math.min(y, lastY)));
      rect.setAttribute('width', String(Math.abs(x - lastX)));
      rect.setAttribute('height', String(Math.abs(y - lastY)));
      e.preventDefault();
    };
    const up = async (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      this.stopPicking();
      if (Math.abs(x - lastX) < 3 || Math.abs(y - lastY) < 3) return;
      const doc = side === 'left' ? pdfStore.getState().leftDoc : pdfStore.getState().rightDoc;
      if (!doc) return;
      const viewport = (await doc.getPage(page)).getViewport({ scale: 1 });
      if (contractStore.getState()[side].contractId !== contractId) return;
      const meta = contractStore.getState()[side].data?.metadata?.page_sizes as
        | Array<{ page_idx: number; width: number; height: number }>
        | undefined;
      const size = meta?.find((s) => s.page_idx === page - 1);
      const width = size?.width ?? viewport.width,
        height = size?.height ?? viewport.height;
      this.openCreate({
        side,
        page,
        bbox: [
          (Math.min(x, lastX) / bounds.width) * width,
          (Math.min(y, lastY) / bounds.height) * height,
          (Math.max(x, lastX) / bounds.width) * width,
          (Math.max(y, lastY) / bounds.height) * height,
        ],
      });
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === event.pointerId) this.stopPicking();
    };
    this.pickCleanup = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      if (wrapper.hasPointerCapture(event.pointerId)) wrapper.releasePointerCapture(event.pointerId);
      rect.remove();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  }
}
