import { useEffect, useState } from 'react';
import { fetchHistory, fetchRepoInfo, pickDirectory } from '../api';
import type { HistoryEntry, RepoInfo, Target } from '../types';

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const TARGET_ICON: Record<Target['kind'], string> = {
  gitlab: '🦊',
  github: '🐙',
  local: '📁',
};

export function StartScreen({ onOpen }: { onOpen: (t: Target) => void }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    fetchHistory().then(setHistory, () => {});
  }, []);

  // URL form
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const openUrl = () => {
    const trimmed = url.trim();
    if (/\/-\/merge_requests\/\d+/.test(trimmed)) {
      onOpen({ kind: 'gitlab', url: trimmed });
    } else if (/\/pull\/\d+/.test(trimmed) || /\/compare\/./.test(trimmed)) {
      onOpen({ kind: 'github', url: trimmed });
    } else {
      setUrlError('Expected a GitLab MR URL, or a GitHub PR / compare URL.');
    }
  };

  // Local repo form
  const [repoPath, setRepoPath] = useState('');
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');

  const lookupRepo = async (path = repoPath) => {
    if (!path.trim() || loadingRepo) return;
    setLoadingRepo(true);
    setRepoError(null);
    try {
      const info = await fetchRepoInfo(path.trim());
      setRepoInfo(info);
      setRepoPath(info.repoPath);
      setBase(info.defaultBranch);
      setHead(info.currentBranch);
    } catch (e) {
      setRepoInfo(null);
      setRepoError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRepo(false);
    }
  };

  const browse = async () => {
    try {
      const path = await pickDirectory();
      if (path) {
        setRepoPath(path);
        setRepoError(null);
        await lookupRepo(path);
      }
    } catch (e) {
      setRepoError(e instanceof Error ? e.message : String(e));
    }
  };

  const openRepo = () => {
    if (!repoInfo || !base.trim() || !head.trim()) return;
    onOpen({ kind: 'local', repoPath: repoInfo.repoPath, base: base.trim(), head: head.trim() });
  };

  return (
    <div className="start-screen">
      <div className="start-card">
        <h1>Code Review</h1>
        <p className="start-hint">Review a diff and build an LLM prompt from your comments.</p>

        <section className="start-section">
          <label htmlFor="url-input">GitLab MR, GitHub PR, or compare URL</label>
          <div className="start-row">
            <input
              id="url-input"
              type="text"
              value={url}
              placeholder="https://gitlab.com/group/repo/-/merge_requests/123"
              onChange={(e) => {
                setUrl(e.target.value);
                setUrlError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && openUrl()}
            />
            <button className="btn btn-primary" onClick={openUrl} disabled={!url.trim()}>
              Open
            </button>
          </div>
          {urlError && <div className="start-error">{urlError}</div>}
        </section>

        <div className="start-divider">or</div>

        <section className="start-section">
          <label htmlFor="repo-input">Local git repository</label>
          <div className="start-row">
            <input
              id="repo-input"
              type="text"
              value={repoPath}
              placeholder="~/code/my-project"
              onChange={(e) => {
                setRepoPath(e.target.value);
                setRepoInfo(null);
                setRepoError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && lookupRepo()}
              onBlur={() => lookupRepo()}
            />
            <button className="btn" onClick={browse} title="Pick a directory">
              Browse…
            </button>
            {!repoInfo && (
              <button className="btn" onClick={() => lookupRepo()} disabled={!repoPath.trim() || loadingRepo}>
                {loadingRepo ? 'Loading…' : 'Load'}
              </button>
            )}
          </div>
          {repoError && <div className="start-error">{repoError}</div>}
          {repoInfo && (
            <>
              <div className="start-row branches">
                <div className="branch-field">
                  <label htmlFor="base-input">Base</label>
                  <input
                    id="base-input"
                    type="text"
                    list="branch-list"
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && openRepo()}
                  />
                </div>
                <span className="branch-arrow">←</span>
                <div className="branch-field">
                  <label htmlFor="head-input">Head</label>
                  <input
                    id="head-input"
                    type="text"
                    list="branch-list"
                    value={head}
                    onChange={(e) => setHead(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && openRepo()}
                  />
                </div>
                <datalist id="branch-list">
                  {repoInfo.branches.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
                <button className="btn btn-primary" onClick={openRepo} disabled={!base.trim() || !head.trim()}>
                  Open
                </button>
              </div>
              <p className="start-hint">Compared via merge-base, like an MR: changes on head since it diverged from base.</p>
            </>
          )}
        </section>

        {history.length > 0 && (
          <section className="start-section">
            <label>Recent</label>
            <ul className="recent-list">
              {history.map((entry, i) => (
                <li key={i}>
                  <button className="recent-item" onClick={() => onOpen(entry.target)}>
                    <span className="recent-icon">{TARGET_ICON[entry.target.kind] ?? '📄'}</span>
                    <span className="recent-text">
                      <span className="recent-title">{entry.title}</span>
                      <span className="recent-subtitle">{entry.subtitle}</span>
                    </span>
                    <span className="recent-time">{timeAgo(entry.openedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
