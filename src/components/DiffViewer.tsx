import { useEffect, useRef } from 'react';
import { selectionRange, useReview } from '../store';
import type { DiffFile as DiffFileType } from '../types';
import { DiffFile } from './DiffFile';

interface Props {
  files: DiffFileType[];
  onActiveFile: (path: string | null) => void;
}

export function DiffViewer({ files, onActiveFile }: Props) {
  const { selection, setSelection, dragging, setDragging, setDraft } = useReview();
  const viewerRef = useRef<HTMLElement>(null);
  const rafRef = useRef(0);

  // Track which file section spans the top of the viewport
  const updateActiveFile = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const top = viewer.getBoundingClientRect().top + 1;
      let active: string | null = null;
      for (const section of viewer.querySelectorAll<HTMLElement>('.diff-file')) {
        const rect = section.getBoundingClientRect();
        if (rect.top <= top && rect.bottom > top) {
          active = section.dataset.path ?? null;
          break;
        }
        if (rect.top > top) {
          // Sections are in document order; the first one below the top
          // edge is the active one when nothing spans it.
          active ??= section.dataset.path ?? null;
          break;
        }
      }
      onActiveFile(active);
    });
  };

  useEffect(() => {
    updateActiveFile();
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // Finalize drag-selection → open a comment editor at the end of the range
  useEffect(() => {
    if (!dragging) return;
    const onMouseUp = () => {
      setDragging(false);
      if (selection) {
        const { start, end } = selectionRange(selection);
        setDraft({
          file: selection.file,
          side: selection.side,
          startLine: start,
          endLine: end,
          initialBody: '',
          editingId: null,
        });
      }
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [dragging, selection, setDragging, setDraft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelection(null);
        setDraft(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelection, setDraft]);

  return (
    <main className="diff-viewer" ref={viewerRef} onScroll={updateActiveFile}>
      {files.map((file) => (
        <DiffFile key={`${file.oldPath}→${file.newPath}`} file={file} />
      ))}
    </main>
  );
}
