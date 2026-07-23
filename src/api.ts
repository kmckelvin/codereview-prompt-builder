import type { HistoryEntry, MRData, RepoInfo, ReviewComment, Target, WorkspaceInfo } from './types';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

// All review endpoints are scoped to the target being reviewed. ReviewView
// sets it before loading; the file-lines cache is per-target.
let currentTarget: Target | null = null;
const fileLinesCache = new Map<string, Promise<string[]>>();

export function setApiTarget(target: Target): void {
  if (JSON.stringify(target) !== JSON.stringify(currentTarget)) {
    currentTarget = target;
    fileLinesCache.clear();
  }
}

const tParam = () => encodeURIComponent(JSON.stringify(currentTarget));

export function fetchBoot(): Promise<{ target: Target | null }> {
  return fetch('/api/boot').then((r) => json<{ target: Target | null }>(r));
}

export function fetchHistory(): Promise<HistoryEntry[]> {
  return fetch('/api/history').then((r) => json<HistoryEntry[]>(r));
}

/** Native macOS folder picker; resolves to null if the user cancels. */
export function pickDirectory(): Promise<string | null> {
  return fetch('/api/pick-directory', { method: 'POST' })
    .then((r) => json<{ path: string | null }>(r))
    .then((r) => r.path);
}

export function fetchRepoInfo(repoPath: string): Promise<RepoInfo> {
  return fetch('/api/repo-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath }),
  }).then((r) => json<RepoInfo>(r));
}

/** Child-repo change summary for a directory that contains git repos. */
export function fetchWorkspaceInfo(rootPath: string): Promise<WorkspaceInfo> {
  return fetch('/api/workspace-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootPath }),
  }).then((r) => json<WorkspaceInfo>(r));
}

export function fetchMR(): Promise<MRData> {
  return fetch('/api/mr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: currentTarget }),
  }).then((r) => json<MRData>(r));
}

/** Full new-side file content at the review head, split into lines (1-based access via lines[n-1]). Cached per target+path. */
export function fetchFileLines(path: string): Promise<string[]> {
  let cached = fileLinesCache.get(path);
  if (!cached) {
    cached = fetch(`/api/file?path=${encodeURIComponent(path)}&t=${tParam()}`)
      .then((r) => json<{ content: string }>(r))
      .then(({ content }) => {
        const lines = content.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        return lines;
      });
    cached.catch(() => fileLinesCache.delete(path));
    fileLinesCache.set(path, cached);
  }
  return cached;
}

export function fetchState(): Promise<{ comments: ReviewComment[] }> {
  return fetch(`/api/state?t=${tParam()}`).then((r) => json<{ comments: ReviewComment[] }>(r));
}

export function saveState(comments: ReviewComment[]): Promise<void> {
  return fetch(`/api/state?t=${tParam()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comments }),
  }).then(() => undefined);
}
