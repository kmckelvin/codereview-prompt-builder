import { useState } from 'react';
import { parseImport } from '../promptFormat';
import type { ReviewComment } from '../types';

interface Props {
  hasComments: boolean;
  onClose: () => void;
  onImport: (comments: ReviewComment[]) => void;
}

export function ImportDialog({ hasComments, onClose, onImport }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const doImport = () => {
    try {
      const comments = parseImport(text);
      if (hasComments && !window.confirm(`Replace your current comments with ${comments.length} imported comment${comments.length === 1 ? '' : 's'}?`)) {
        return;
      }
      onImport(comments);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Import comments">
        <h2>Import comments</h2>
        <p className="modal-hint">
          Paste a previously copied prompt (or the saved JSON state) to restore its comments.
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder={'MR: https://gitlab.com/…\n\npath/to/file.rb:123-456 - comment text'}
          rows={12}
        />
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={doImport} disabled={!text.trim()}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
