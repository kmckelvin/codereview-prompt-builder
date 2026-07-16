import { useEffect, useState } from 'react';
import { buildPrompt } from '../promptFormat';
import { useReview, type ViewMode } from '../store';
import type { MRInfo } from '../types';

interface Props {
  info: MRInfo;
  viewMode: ViewMode;
  onViewMode: (m: ViewMode) => void;
  commentCount: number;
  onImport: () => void;
  onClear: () => void;
}

export function Toolbar({ info, viewMode, onViewMode, commentCount, onImport, onClear }: Props) {
  const { comments } = useReview();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(buildPrompt(info.promptHeader, comments));
    setCopied(true);
  };

  return (
    <header className="toolbar">
      <div className="toolbar-title">
        {info.webUrl ? (
          <a href={info.webUrl} target="_blank" rel="noreferrer" title="Open MR in GitLab">
            {info.title}
          </a>
        ) : (
          <span className="toolbar-title-text">{info.title}</span>
        )}
        <span className="toolbar-meta">
          {info.sourceBranch} → {info.targetBranch}
          {info.author && ` · ${info.author}`}
        </span>
      </div>
      <div className="toolbar-actions">
        <div className="segmented" role="group" aria-label="Diff view mode">
          {(['unified', 'split'] as const).map((m) => (
            <button
              key={m}
              className={viewMode === m ? 'active' : ''}
              onClick={() => onViewMode(m)}
            >
              {m === 'unified' ? 'Unified' : 'Split'}
            </button>
          ))}
        </div>
        <button className="btn" onClick={onImport}>
          Import
        </button>
        <button
          className="btn btn-danger"
          disabled={commentCount === 0}
          onClick={() => {
            if (window.confirm(`Clear all ${commentCount} comment${commentCount === 1 ? '' : 's'}? This cannot be undone.`)) {
              onClear();
            }
          }}
        >
          Clear
        </button>
        <button className="btn btn-primary" onClick={copyPrompt} disabled={commentCount === 0}>
          {copied ? 'Copied!' : `Copy prompt${commentCount > 0 ? ` (${commentCount})` : ''}`}
        </button>
      </div>
    </header>
  );
}
