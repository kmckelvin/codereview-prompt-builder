import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchFileLines } from '../api';
import { EXPAND_CHUNK, expandGap, gapAbove } from '../expand';
import { highlightHunks, langForPath, type HighlightedHunk } from '../highlight';
import { intraLineDiff, type CharRange } from '../intraDiff';
import { lineInSelection, useReview } from '../store';
import type { DiffFile as DiffFileType, DiffLine, Hunk, ReviewComment, Side } from '../types';
import { CommentEditor, CommentThread } from './CommentEditor';
import { fileAnchorId } from './FileTree';

/** A diff line plus its token-line indices within its hunk's highlighted sides. */
interface RL {
  line: DiffLine;
  hunkIdx: number;
  oldTok: number | null;
  newTok: number | null;
  /** Changed-char ranges within this line's own side (word-level diff vs its paired line). */
  emph: CharRange[] | null;
}

type UnifiedRow = { type: 'header'; hunkIdx: number } | { type: 'line'; rl: RL };
type SplitRow = { type: 'header'; hunkIdx: number } | { type: 'pair'; left: RL | null; right: RL | null };

function buildRLs(hunks: Hunk[]): RL[][] {
  return hunks.map((hunk, hunkIdx) => {
    let oldTok = 0;
    let newTok = 0;
    const rls: RL[] = hunk.lines.map((line) => ({
      line,
      hunkIdx,
      oldTok: line.kind !== 'add' ? oldTok++ : null,
      newTok: line.kind !== 'del' ? newTok++ : null,
      emph: null,
    }));
    // Pair del/add runs the same way the split view zips them, and emphasize
    // the exact text that changed within each pair.
    let dels: RL[] = [];
    let adds: RL[] = [];
    const flush = () => {
      const n = Math.min(dels.length, adds.length);
      for (let i = 0; i < n; i++) {
        const d = intraLineDiff(dels[i].line.text, adds[i].line.text);
        if (d) {
          dels[i].emph = d.old;
          adds[i].emph = d.new;
        }
      }
      dels = [];
      adds = [];
    };
    for (const rl of rls) {
      if (rl.line.kind === 'del') dels.push(rl);
      else if (rl.line.kind === 'add') adds.push(rl);
      else flush();
    }
    flush();
    return rls;
  });
}

function buildSplitRows(rls: RL[][]): SplitRow[] {
  const rows: SplitRow[] = [];
  rls.forEach((hunkLines, hunkIdx) => {
    rows.push({ type: 'header', hunkIdx });
    let dels: RL[] = [];
    let adds: RL[] = [];
    const flush = () => {
      const n = Math.max(dels.length, adds.length);
      for (let i = 0; i < n; i++) {
        rows.push({ type: 'pair', left: dels[i] ?? null, right: adds[i] ?? null });
      }
      dels = [];
      adds = [];
    };
    for (const rl of hunkLines) {
      if (rl.line.kind === 'del') dels.push(rl);
      else if (rl.line.kind === 'add') adds.push(rl);
      else {
        flush();
        rows.push({ type: 'pair', left: rl, right: rl });
      }
    }
    flush();
  });
  return rows;
}

function useVisible(ref: React.RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '400px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref, visible]);
  return visible;
}

function GapControls({
  hunks,
  gapIdx,
  fileLineCount,
  onExpand,
}: {
  hunks: Hunk[];
  gapIdx: number;
  fileLineCount: number | null;
  onExpand: (gapIdx: number, dir: 'up' | 'down' | 'all') => void;
}) {
  const hidden = gapAbove(hunks, gapIdx, fileLineCount);
  if (hidden !== null && hidden <= 0) return null;
  const isTop = gapIdx === 0;
  const isBottom = gapIdx === hunks.length;
  const chunked = hidden === null || hidden > EXPAND_CHUNK;
  return (
    <span className="gap-controls">
      {chunked && !isBottom && (
        <button title={`Show ${EXPAND_CHUNK} lines above`} onClick={() => onExpand(gapIdx, 'up')}>
          ↑{EXPAND_CHUNK}
        </button>
      )}
      {chunked && !isTop && (
        <button title={`Show ${EXPAND_CHUNK} more lines below`} onClick={() => onExpand(gapIdx, 'down')}>
          ↓{EXPAND_CHUNK}
        </button>
      )}
      <button title="Show all hidden lines" onClick={() => onExpand(gapIdx, 'all')}>
        ↕{hidden !== null ? ` ${hidden} line${hidden === 1 ? '' : 's'}` : ' all'}
      </button>
    </span>
  );
}

/** Split `content` (starting at char offset `offset` in the line) at the boundaries of `ranges`. */
function splitByRanges(content: string, offset: number, ranges: CharRange[]): { text: string; emph: boolean }[] {
  const segs: { text: string; emph: boolean }[] = [];
  let i = 0;
  while (i < content.length) {
    const abs = offset + i;
    const inside = ranges.find(([s, e]) => abs >= s && abs < e);
    let end: number;
    if (inside) {
      end = Math.min(content.length, inside[1] - offset);
    } else {
      const next = Math.min(...ranges.map(([s]) => s).filter((s) => s > abs));
      end = Math.min(content.length, next - offset);
    }
    segs.push({ text: content.slice(i, end), emph: !!inside });
    i = end;
  }
  return segs;
}

function CodeText({
  text,
  tokens,
  emph,
}: {
  text: string;
  tokens: { content: string; color?: string }[] | null;
  emph: CharRange[] | null;
}) {
  const toks = tokens ?? [{ content: text, color: undefined }];
  if (!emph || emph.length === 0) {
    if (!tokens) return <>{text}</>;
    return (
      <>
        {tokens.map((t, i) => (
          <span key={i} style={{ color: t.color }}>
            {t.content}
          </span>
        ))}
      </>
    );
  }
  let pos = 0;
  const parts: React.ReactNode[] = [];
  toks.forEach((t, i) => {
    splitByRanges(t.content, pos, emph).forEach((seg, j) => {
      parts.push(
        <span key={`${i}.${j}`} className={seg.emph ? 'code-emph' : undefined} style={{ color: t.color }}>
          {seg.text}
        </span>,
      );
    });
    pos += t.content.length;
  });
  return <>{parts}</>;
}

/** Comments anchored under the row that shows `side` line number `endLine`. */
function anchoredHere(comments: ReviewComment[], file: string, line: DiffLine): ReviewComment[] {
  return comments.filter(
    (c) =>
      c.file === file &&
      ((c.side === 'new' && line.kind !== 'del' && line.newLine === c.endLine) ||
        (c.side === 'old' && line.kind !== 'add' && line.oldLine === c.endLine)),
  );
}

export const DiffFile = memo(function DiffFile({ file }: { file: DiffFileType }) {
  const { comments, selection, setSelection, dragging, setDragging, setDraft, draft, viewMode, dark } = useReview();
  const ref = useRef<HTMLDivElement>(null);
  const visible = useVisible(ref);
  const [collapsed, setCollapsed] = useState(false);
  const [tokens, setTokens] = useState<HighlightedHunk[] | null>(null);
  const [hunks, setHunks] = useState<Hunk[]>(file.hunks);
  const [fileLineCount, setFileLineCount] = useState<number | null>(null);
  const [pathCopied, setPathCopied] = useState(false);

  const path = file.status === 'deleted' ? file.oldPath : file.newPath;
  const lang = useMemo(() => langForPath(path), [path]);

  useEffect(() => {
    if (!visible || collapsed) return;
    let cancelled = false;
    highlightHunks(hunks, lang, dark).then(
      (t) => {
        if (!cancelled) setTokens(t);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [visible, collapsed, hunks, lang, dark]);

  useEffect(() => {
    if (!pathCopied) return;
    const t = window.setTimeout(() => setPathCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [pathCopied]);

  // Context expansion needs the new-side file content, which doesn't exist
  // for deleted files; added files are already shown in full.
  const canExpand = file.status !== 'deleted' && file.status !== 'added' && hunks.length > 0;

  const onExpand = useCallback(
    (gapIdx: number, dir: 'up' | 'down' | 'all') => {
      fetchFileLines(path).then((lines) => {
        setFileLineCount(lines.length);
        setHunks((prev) => expandGap(prev, gapIdx, dir, lines));
      }, () => {});
    },
    [path],
  );

  const rls = useMemo(() => buildRLs(hunks), [hunks]);
  const unifiedRows = useMemo<UnifiedRow[]>(
    () =>
      rls.flatMap((hunkLines, hunkIdx) => [
        { type: 'header' as const, hunkIdx },
        ...hunkLines.map((rl) => ({ type: 'line' as const, rl })),
      ]),
    [rls],
  );
  const splitRows = useMemo(() => buildSplitRows(rls), [rls]);

  // Gutter interaction: mousedown anchors a selection, mouseenter (while
  // dragging) extends it within the same file+side, mouseup (global, in
  // DiffViewer) finalizes it into a comment draft.
  const gutterProps = (side: Side, lineNo: number | null) => {
    if (lineNo === null) return {};
    return {
      onMouseDown: (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        setDraft(null);
        setSelection({ file: path, side, anchor: lineNo, head: lineNo });
        setDragging(true);
      },
      onMouseEnter: () => {
        if (dragging && selection && selection.file === path && selection.side === side) {
          setSelection({ ...selection, head: lineNo });
        }
      },
    };
  };

  const tokensFor = (rl: RL, side: Side): { content: string; color?: string }[] | null => {
    if (!tokens) return null;
    const hunkTokens = tokens[rl.hunkIdx];
    if (!hunkTokens) return null;
    const idx = side === 'old' ? rl.oldTok : rl.newTok;
    return idx === null ? null : (hunkTokens[side][idx] ?? null);
  };

  const draftHere = (line: DiffLine): boolean =>
    !!draft &&
    draft.editingId === null &&
    draft.file === path &&
    ((draft.side === 'new' && line.kind !== 'del' && line.newLine === draft.endLine) ||
      (draft.side === 'old' && line.kind !== 'add' && line.oldLine === draft.endLine));

  const renderAttachments = (line: DiffLine, colSpanClass: string) => {
    const anchored = anchoredHere(comments, path, line);
    const hasDraft = draftHere(line);
    if (anchored.length === 0 && !hasDraft) return null;
    return (
      <div className={`attachment-row ${colSpanClass}`}>
        {anchored.length > 0 && <CommentThread comments={anchored} />}
        {hasDraft && <CommentEditor />}
      </div>
    );
  };

  const selCls = (side: Side, lineNo: number | null) =>
    lineInSelection(selection, path, side, lineNo) ? ' selected' : '';

  const title =
    file.status === 'renamed' && file.oldPath !== file.newPath
      ? `${file.oldPath} → ${file.newPath}`
      : path;

  const copyPath = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path).then(() => setPathCopied(true), () => {});
  };

  const hunkHeader = (hunkIdx: number, key: React.Key) => (
    <div key={key} className="hunk-header">
      {canExpand && (
        <GapControls hunks={hunks} gapIdx={hunkIdx} fileLineCount={fileLineCount} onExpand={onExpand} />
      )}
      <span className="hunk-header-text">{hunks[hunkIdx].header}</span>
    </div>
  );

  const bottomHidden = canExpand ? gapAbove(hunks, hunks.length, fileLineCount) : 0;
  const bottomExpander = bottomHidden === 0 ? null : (
    <div className="hunk-header">
      <GapControls hunks={hunks} gapIdx={hunks.length} fileLineCount={fileLineCount} onExpand={onExpand} />
    </div>
  );

  return (
    <section className="diff-file" id={fileAnchorId(file.newPath)} data-path={file.newPath} ref={ref}>
      <header className="diff-file-header" onClick={() => setCollapsed(!collapsed)}>
        <span className={`chevron ${collapsed ? '' : 'open'}`}>▸</span>
        <span className="diff-file-path">{title}</span>
        <button className="copy-path" title="Copy file path" onClick={copyPath}>
          {pathCopied ? (
            '✓ copied'
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-label="Copy file path">
              <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
              <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
            </svg>
          )}
        </button>
        <span className={`status status-${file.status}`}>{file.status}</span>
      </header>

      {!collapsed && hunks.length === 0 && (
        <div className="diff-empty">No text changes (binary file or rename only).</div>
      )}

      {!collapsed && hunks.length > 0 && viewMode === 'unified' && (
        <div className="diff-table unified">
          {unifiedRows.map((row, i) => {
            if (row.type === 'header') {
              return hunkHeader(row.hunkIdx, i);
            }
            const { line } = row.rl;
            const side: Side = line.kind === 'del' ? 'old' : 'new';
            const lineNo = side === 'old' ? line.oldLine : line.newLine;
            const sel = selCls(side, lineNo);
            return (
              <div key={i}>
                <div className={`diff-row kind-${line.kind}${sel}`}>
                  <span className={`gutter${sel}`} {...gutterProps(side, lineNo)}>
                    {line.oldLine ?? ''}
                  </span>
                  <span className={`gutter${sel}`} {...gutterProps(side, lineNo)}>
                    {line.newLine ?? ''}
                  </span>
                  <span className="marker">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
                  <code className="code">
                    <CodeText text={line.text} tokens={tokensFor(row.rl, side)} emph={row.rl.emph} />
                  </code>
                </div>
                {renderAttachments(line, 'unified-span')}
              </div>
            );
          })}
          {bottomExpander}
        </div>
      )}

      {!collapsed && hunks.length > 0 && viewMode === 'split' && (
        <div className="diff-table split">
          {splitRows.map((row, i) => {
            if (row.type === 'header') {
              return hunkHeader(row.hunkIdx, i);
            }
            const { left, right } = row;
            const isContext = left !== null && left === right;
            // Context lines always comment as 'new' side so the prompt only
            // marks genuinely deleted lines as (deleted).
            const leftSide: Side = isContext ? 'new' : 'old';
            const leftNo = isContext ? left.line.newLine : (left?.line.oldLine ?? null);
            const rightNo = right?.line.newLine ?? null;
            const leftSel = left ? selCls(leftSide, leftNo) : '';
            const rightSel = right ? selCls('new', rightNo) : '';
            return (
              <div key={i}>
                <div className="diff-row-split">
                  <span className={`gutter${leftSel}`} {...(left ? gutterProps(leftSide, leftNo) : {})}>
                    {left?.line.oldLine ?? ''}
                  </span>
                  <code className={`code half kind-${left ? (isContext ? 'context' : 'del') : 'empty'}${leftSel}`}>
                    {left && <CodeText text={left.line.text} tokens={tokensFor(left, 'old')} emph={left.emph} />}
                  </code>
                  <span className={`gutter${rightSel}`} {...(right ? gutterProps('new', rightNo) : {})}>
                    {right?.line.newLine ?? ''}
                  </span>
                  <code className={`code half kind-${right ? (isContext ? 'context' : 'add') : 'empty'}${rightSel}`}>
                    {right && <CodeText text={right.line.text} tokens={tokensFor(right, 'new')} emph={right.emph} />}
                  </code>
                </div>
                {left && renderAttachments(left.line, 'split-span')}
                {right && right !== left && renderAttachments(right.line, 'split-span')}
              </div>
            );
          })}
          {bottomExpander}
        </div>
      )}
    </section>
  );
});
