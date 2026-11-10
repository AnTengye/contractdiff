import { extractText, findSegmentsInRange } from './textv2/textExtractor';
import type { ContractData, RenderSegment, TextDiffResultV2 } from './textv2';
import type { AIFinding, AIJob, AILocation } from '@/services/api/aiDiff';
import { diffChars } from 'diff';

export interface MappedAIFinding {
  finding: AIFinding;
  left: { location: AILocation; candidates: RenderSegment[][] };
  right: { location: AILocation; candidates: RenderSegment[][] };
  relatedAlgorithmIds: number[];
}

// A model never supplies geometry. Validate the exact normalized source snapshot
// before using the existing character/span/line/block boxes for each quote.
export function mapAIFindings(job: AIJob, result: TextDiffResultV2, left: ContractData, right: ContractData): MappedAIFinding[] {
  const extracted = { left: extractText(left, result.metadata?.options), right: extractText(right, result.metadata?.options) };
  return job.findings.map((finding, index) => {
    const related = new Set<number>();
    function mapSide(side: 'left' | 'right') {
      const source = side === 'left' ? left : right;
      const location = side === 'left' ? finding.before : finding.after;
      const document = job.documents[side];
      const expected = source.metadata;
      const mismatch = (expected?.pdf_hash && expected.pdf_hash !== document.pdf_hash) ||
        (expected?.result_signature && expected.result_signature !== document.result_signature);
      let invalid = Boolean(mismatch);
      const candidates = (location.candidates ?? []).map((candidate, candidateIndex) => {
        const segments: RenderSegment[] = [];
        const positions: Array<{start:number;end:number}> = [];
        for (const range of candidate.ranges) {
          const unit = extracted[side].units[range.unit_index];
          const original = document.units[range.unit_index];
          if (!unit || !original || original.id !== range.unit_id || unit.text !== original.text ||
              unit.blockIdx !== original.block_idx || range.start < 0 || range.end > unit.text.length || range.start >= range.end) {
            invalid = true;
            continue;
          }
          const start = unit.startOffset + range.start, end = unit.startOffset + range.end;
          let offset = start;
          for (const char of extracted[side].fullText.slice(start,end)) {
            if (!/\s/u.test(char)) for (let i=0;i<char.length;i++) positions.push({start:offset,end:offset+char.length});
            offset += char.length;
          }
          for (const change of result.changes) {
            const lo = side === 'left' ? change.leftStartOffset : change.rightStartOffset;
            const hi = side === 'left' ? change.leftEndOffset : change.rightEndOffset;
            if (change.type !== 'unchanged' && change.diffId !== undefined && lo !== undefined && hi !== undefined && start < hi && end > lo)
              related.add(change.diffId);
          }
        }
        // Highlight actual edits within the verified quote. Coarse source boxes
        // remain coarse; character rectangles are used only when supplied.
        const ranges: Array<{start:number;end:number}> = [];
        let contextOnly = false;
        if (finding.category === 'text' && finding.kind === 'modified') {
          let cursor = 0;
          for (const part of diffChars(finding.before.quote.replace(/\s/gu,''),finding.after.quote.replace(/\s/gu,''))) {
            if (side === 'left' ? part.added : part.removed) continue;
            if (part.added || part.removed) {
              const points = positions.slice(cursor,cursor+part.value.length);
              for (const p of points) {
                const last = ranges[ranges.length-1];
                if (last && p.start <= last.end) last.end = Math.max(last.end,p.end);
                else ranges.push({...p});
              }
            }
            cursor += part.value.length;
          }
          if (!ranges.length) contextOnly = true;
        }
        if (finding.category !== 'text' || finding.kind !== 'modified' || contextOnly) for (const range of candidate.ranges) {
          const unit = extracted[side].units[range.unit_index];
          if (unit) ranges.push({start:unit.startOffset+range.start,end:unit.startOffset+range.end});
        }
        for (const {start,end} of ranges) {
          for (const segment of findSegmentsInRange(result[side].textSegments, start, end)) {
            const lo = Math.max(start, segment.startOffset), hi = Math.min(end, segment.endOffset);
            segments.push({
              text: segment.text.slice(lo-segment.startOffset, hi-segment.startOffset),
              type: finding.kind === 'moved' ? 'moved' : side === 'left' ? 'removed' : 'added',
              diffId: result.stats.totalChanges + index,
              pageIdx: segment.pageIdx, blockIdx: segment.blockIdx,
              bbox: segment.bbox, pageSize: segment.pageSize, precision: segment.precision,
              source: 'ai', category: finding.category,
              contextOnly,
              ambiguous: location.status === 'ambiguous',
              candidateLabel: location.status === 'ambiguous' ? String.fromCharCode(65+candidateIndex) : undefined,
            });
          }
        }
        return segments;
      });
      if (invalid) return { location: { ...location, status: 'unresolved' as const, reason: '原文已变化或引用位置不一致，请重新比对', candidates: [] }, candidates: [] };
      return { location, candidates };
    }
    const l = mapSide('left'), r = mapSide('right');
    return { finding, left: l, right: r, relatedAlgorithmIds: [...related].sort((a,b)=>a-b) };
  });
}

export function locationLabel(side: MappedAIFinding['left']): string {
  if (side.location.status === 'not_applicable') return '无对应原文';
  if (side.location.status === 'unresolved') return '待确认定位';
  if (side.location.status === 'ambiguous') return `${side.candidates.length} 个候选位置`;
  const segments = side.candidates.flat();
  if (!segments.some(s=>s.bbox)) return '待确认定位';
  if (segments.some(s=>s.contextOnly)) return '上下文定位';
  if (segments.filter(s=>s.text.trim()).every(s=>s.precision === 'character' && s.bbox)) return '字符定位';
  return '区域定位';
}
