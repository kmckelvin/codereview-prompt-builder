import type { MRData, ReviewComment } from './types';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export function fetchMR(): Promise<MRData> {
  return fetch('/api/mr').then((r) => json<MRData>(r));
}

/** Full new-side file content at the MR head, split into lines (1-based access via lines[n-1]). */
export async function fetchFileLines(path: string): Promise<string[]> {
  const { content } = await fetch(`/api/file?path=${encodeURIComponent(path)}`).then((r) =>
    json<{ content: string }>(r),
  );
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function fetchState(): Promise<{ comments: ReviewComment[] }> {
  return fetch('/api/state').then((r) => json<{ comments: ReviewComment[] }>(r));
}

export function saveState(comments: ReviewComment[]): Promise<void> {
  return fetch('/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comments }),
  }).then(() => undefined);
}
