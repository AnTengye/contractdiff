import type { DiffState } from '@/store/diffStore';
import type { RenderSegment } from './textv2';

export function displaySegments(state: Readonly<DiffState>, side: 'left'|'right'): RenderSegment[] {
  const item = state.aiFindings[state.currentDiffIndex-state.stats.total];
  if (!item) return state.textDiffResult?.[side].segments ?? [];
  const candidate = state.aiCandidates[`${item.finding.id}:${side}`];
  const segments = candidate === undefined ? item[side].candidates.flat() : item[side].candidates[candidate] ?? [];
  if (item.finding.category !== 'format') return segments;
  const regions = new Map<string, RenderSegment>();
  for (const segment of segments) {
    if (!segment.bbox) continue;
    const key = `${segment.pageIdx}:${segment.blockIdx}:${segment.candidateLabel ?? ''}`;
    const old = regions.get(key);
    if (!old) regions.set(key,{ ...segment, bbox:[...segment.bbox], precision:'block' });
    else {
      old.text += segment.text;
      old.bbox = [Math.min(old.bbox![0],segment.bbox[0]),Math.min(old.bbox![1],segment.bbox[1]),Math.max(old.bbox![2],segment.bbox[2]),Math.max(old.bbox![3],segment.bbox[3])];
    }
  }
  return [...regions.values()];
}
