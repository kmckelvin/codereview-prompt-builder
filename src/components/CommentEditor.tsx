import { useEffect, useRef, useState } from 'react';
import { buildPrompt } from '../promptFormat';
import { useReview } from '../store';
import type { ReviewComment } from '../types';

function rangeLabel(startLine: number, endLine: number, side: 'old' | 'new'): string {
  const range = startLine === endLine ? `${startLine}` : `${startLine}–${endLine}`;
  return side === 'old' ? `${range} (deleted)` : range;
}

/** Inline editor for the current draft (new comment or edit-in-place). */
export function CommentEditor() {
  const { draft, setDraft, setSelection, addComment, updateComment, promptHeader } = useReview();
  const [body, setBody] = useState(draft?.initialBody ?? '');
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (!draft) return null;

  const cancel = () => {
    setDraft(null);
    setSelection(null);
  };

  const save = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    if (draft.editingId) {
      updateComment(draft.editingId, trimmed);
    } else {
      addComment({
        file: draft.file,
        side: draft.side,
        startLine: draft.startLine,
        endLine: draft.endLine,
        body: trimmed,
      });
    }
    cancel();
  };

  /** Copy this one comment as a standalone prompt, without saving it. */
  const copyPrompt = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const single: ReviewComment = {
      id: '',
      file: draft.file,
      side: draft.side,
      startLine: draft.startLine,
      endLine: draft.endLine,
      body: trimmed,
    };
    navigator.clipboard.writeText(buildPrompt(promptHeader, [single])).then(() => setCopied(true), () => {});
  };

  return (
    <div className="comment-editor" onMouseDown={(e) => e.stopPropagation()}>
      <div className="comment-editor-label">
        Comment on line{draft.startLine === draft.endLine ? '' : 's'}{' '}
        {rangeLabel(draft.startLine, draft.endLine, draft.side)}
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancel();
          }
        }}
        placeholder="Leave a comment… (⌘↵ to save)"
        rows={3}
      />
      <div className="comment-editor-actions">
        <button className="btn" onClick={cancel}>
          Cancel
        </button>
        <button className="btn" onClick={copyPrompt} disabled={!body.trim()}>
          {copied ? 'Copied!' : 'Copy prompt'}
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!body.trim()}>
          {draft.editingId ? 'Save' : 'Add comment'}
        </button>
      </div>
    </div>
  );
}

/** Saved comments anchored under a diff row. */
export function CommentThread({ comments }: { comments: ReviewComment[] }) {
  const { draft, setDraft, setSelection, deleteComment } = useReview();

  return (
    <div className="comment-thread">
      {comments.map((c) =>
        draft?.editingId === c.id ? (
          <CommentEditor key={c.id} />
        ) : (
          <div key={c.id} className="comment">
            <div className="comment-header">
              <span className="comment-range">
                {c.file}:{rangeLabel(c.startLine, c.endLine, c.side)}
              </span>
              <span className="comment-actions">
                <button
                  className="btn-link"
                  onClick={() => {
                    setSelection(null);
                    setDraft({
                      file: c.file,
                      side: c.side,
                      startLine: c.startLine,
                      endLine: c.endLine,
                      initialBody: c.body,
                      editingId: c.id,
                    });
                  }}
                >
                  Edit
                </button>
                <button className="btn-link danger" onClick={() => deleteComment(c.id)}>
                  Delete
                </button>
              </span>
            </div>
            <div className="comment-body">{c.body}</div>
          </div>
        ),
      )}
    </div>
  );
}
