/** [start, end) character offsets within a line's text. */
export type CharRange = [number, number];

export interface IntraLineDiff {
  old: CharRange[];
  new: CharRange[];
}

// Word runs stay whole so a changed identifier highlights as a unit;
// punctuation splits per character so `{ID: x}, nil` → `{ID: x, y}, nil`
// emphasizes only the insertion.
const TOKEN_RE = /[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/g;

const tokenize = (s: string): string[] => s.match(TOKEN_RE) ?? [];

const nonWsLength = (s: string): number => s.replace(/\s/g, '').length;

/** Longest-common-subsequence kept-flags for two token arrays. */
function lcsKept(a: string[], b: string[]): { keptA: boolean[]; keptB: boolean[] } {
  const n = a.length;
  const m = b.length;
  const dp = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => dp[i * (m + 1) + j];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const keptA = new Array<boolean>(n).fill(false);
  const keptB = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keptA[i] = keptB[j] = true;
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i++;
    } else {
      j++;
    }
  }
  return { keptA, keptB };
}

/** Char ranges covering tokens not kept, adjacent ranges merged. */
function changedRanges(tokens: string[], kept: boolean[]): CharRange[] {
  const ranges: CharRange[] = [];
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const end = pos + tokens[i].length;
    if (!kept[i]) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] === pos) last[1] = end;
      else ranges.push([pos, end]);
    }
    pos = end;
  }
  return ranges;
}

/**
 * Word-level diff between a paired deleted/added line, GitHub-style: returns
 * the changed character ranges on each side, or null when the lines share too
 * little content for emphasis to be meaningful (then the whole-line tint
 * already says it all).
 */
export function intraLineDiff(oldText: string, newText: string): IntraLineDiff | null {
  if (oldText === newText) return null;
  const ta = tokenize(oldText);
  const tb = tokenize(newText);

  // Trim the common token prefix/suffix first — it makes the typical
  // one-edit line an (almost) empty DP problem.
  let p = 0;
  while (p < ta.length && p < tb.length && ta[p] === tb[p]) p++;
  let s = 0;
  while (s < ta.length - p && s < tb.length - p && ta[ta.length - 1 - s] === tb[tb.length - 1 - s]) s++;

  const midA = ta.slice(p, ta.length - s);
  const midB = tb.slice(p, tb.length - s);
  let keptMidA: boolean[];
  let keptMidB: boolean[];
  if (midA.length * midB.length > 40_000) {
    // Pathologically long lines: fall back to plain prefix/suffix trimming.
    keptMidA = new Array<boolean>(midA.length).fill(false);
    keptMidB = new Array<boolean>(midB.length).fill(false);
  } else {
    ({ keptA: keptMidA, keptB: keptMidB } = lcsKept(midA, midB));
  }
  const keptA = ta.map((_, i) => i < p || i >= ta.length - s || keptMidA[i - p]);
  const keptB = tb.map((_, i) => i < p || i >= tb.length - s || keptMidB[i - p]);

  // Similarity gate: if the lines share too little real content, they're a
  // rewrite, not an edit — emphasizing scattered fragments is just noise.
  const commonNonWs = ta.reduce((sum, tok, i) => sum + (keptA[i] ? nonWsLength(tok) : 0), 0);
  const maxNonWs = Math.max(nonWsLength(oldText), nonWsLength(newText));
  if (maxNonWs > 0 && commonNonWs < 0.3 * maxNonWs) return null;

  const oldRanges = changedRanges(ta, keptA);
  const newRanges = changedRanges(tb, keptB);
  if (oldRanges.length === 0 && newRanges.length === 0) return null;
  return { old: oldRanges, new: newRanges };
}
