import type { ReviewComment } from './types';

export function buildPrompt(header: string, comments: ReviewComment[]): string {
  const sorted = [...comments].sort(
    (a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine,
  );
  const entries = sorted.map((c) => {
    const range = c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`;
    const marker = c.side === 'old' ? ' (deleted)' : '';
    return `${c.file}:${range}${marker} - ${c.body}`;
  });
  return `${header}\n\n${entries.join('\n\n')}\n`;
}

const ENTRY_RE = /^(\S+):(\d+)(?:-(\d+))?( \(deleted\))? - (.*)$/;

let importCounter = 0;
export function newCommentId(): string {
  return `c${Date.now()}-${importCounter++}`;
}

/**
 * Parse pasted state: either the persisted JSON ({"comments":[...]}) or the
 * text prompt format produced by buildPrompt.
 */
export function parseImport(text: string): ReviewComment[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed.comments)) throw new Error('JSON has no "comments" array');
    return parsed.comments.map((c: Partial<ReviewComment>) => {
      if (!c.file || !c.startLine || typeof c.body !== 'string') {
        throw new Error('Malformed comment in JSON');
      }
      return {
        id: c.id ?? newCommentId(),
        file: c.file,
        side: c.side === 'old' ? 'old' : 'new',
        startLine: c.startLine,
        endLine: c.endLine ?? c.startLine,
        body: c.body,
      };
    });
  }

  const comments: ReviewComment[] = [];
  let current: ReviewComment | null = null;
  for (const line of trimmed.split('\n')) {
    if (/^(MR|Repo):\s/.test(line) && !current) continue;
    const m = line.match(ENTRY_RE);
    if (m) {
      current = {
        id: newCommentId(),
        file: m[1],
        side: m[4] ? 'old' : 'new',
        startLine: Number(m[2]),
        endLine: m[3] ? Number(m[3]) : Number(m[2]),
        body: m[5],
      };
      comments.push(current);
    } else if (current) {
      current.body += `\n${line}`;
    }
  }
  for (const c of comments) c.body = c.body.trim();
  const result = comments.filter((c) => c.body.length > 0);
  if (result.length === 0) throw new Error('No comments found in pasted text');
  return result;
}
