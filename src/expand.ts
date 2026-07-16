import type { DiffLine, Hunk } from './types';

export const EXPAND_CHUNK = 20;

/**
 * Hidden new-side lines in the gap above hunk `i` (i in 0..hunks.length; the
 * last index is the gap between the final hunk and EOF, which needs the file
 * line count — pass null to report it as unknown).
 */
export function gapAbove(hunks: Hunk[], i: number, fileLineCount: number | null): number | null {
  if (i === 0) return hunks[0].newStart - 1;
  const prev = hunks[i - 1];
  const prevEnd = prev.newStart + prev.newCount - 1;
  if (i === hunks.length) {
    return fileLineCount === null ? null : Math.max(0, fileLineCount - prevEnd);
  }
  return hunks[i].newStart - prevEnd - 1;
}

function ctxLine(fileLines: string[], newLine: number, delta: number): DiffLine {
  return { kind: 'context', oldLine: newLine + delta, newLine, text: fileLines[newLine - 1] ?? '' };
}

function refreshHeader(h: Hunk): void {
  const trailer = h.header.replace(/^@@ [^@]*@@/, '');
  h.header = `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@${trailer}`;
}

/** Merge hunks whose gap has closed to zero. */
function mergeAdjacent(hunks: Hunk[]): Hunk[] {
  const merged = [hunks[0]];
  for (let i = 1; i < hunks.length; i++) {
    const prev = merged[merged.length - 1];
    if (hunks[i].newStart === prev.newStart + prev.newCount) {
      prev.lines = [...prev.lines, ...hunks[i].lines];
      prev.oldCount += hunks[i].oldCount;
      prev.newCount += hunks[i].newCount;
      refreshHeader(prev);
    } else {
      merged.push(hunks[i]);
    }
  }
  return merged;
}

/**
 * Expand the gap above hunk `gapIdx`.
 * - 'up': reveal lines immediately above the hunk below the gap
 * - 'down': reveal lines immediately below the hunk above the gap
 * - 'all': reveal the whole gap
 * Returns a new hunks array; hunks are merged when a gap closes.
 */
export function expandGap(
  hunks: Hunk[],
  gapIdx: number,
  dir: 'up' | 'down' | 'all',
  fileLines: string[],
): Hunk[] {
  const hs = hunks.map((h) => ({ ...h, lines: [...h.lines] }));
  const hidden = gapAbove(hs, gapIdx, fileLines.length) ?? 0;
  if (hidden <= 0) return hunks;
  const count = dir === 'all' ? hidden : Math.min(EXPAND_CHUNK, hidden);

  // The bottom gap has no hunk below it (must append); the top gap has no
  // hunk above it (must prepend).
  const append = gapIdx === hs.length || (dir === 'down' && gapIdx > 0);
  if (append) {
    // Append below the hunk above the gap
    const h = hs[gapIdx - 1];
    const newEnd = h.newStart + h.newCount - 1;
    const delta = h.oldStart + h.oldCount - 1 - newEnd;
    for (let k = 1; k <= count; k++) h.lines.push(ctxLine(fileLines, newEnd + k, delta));
    h.oldCount += count;
    h.newCount += count;
    refreshHeader(h);
  } else {
    // Prepend above the hunk below the gap ('up' and 'all')
    const h = hs[gapIdx];
    const delta = h.oldStart - h.newStart;
    const prepended: DiffLine[] = [];
    for (let n = h.newStart - count; n < h.newStart; n++) prepended.push(ctxLine(fileLines, n, delta));
    h.lines = [...prepended, ...h.lines];
    h.oldStart -= count;
    h.newStart -= count;
    h.oldCount += count;
    h.newCount += count;
    refreshHeader(h);
  }

  return mergeAdjacent(hs);
}
