import { useEffect } from 'react';
import { selectionRange, useReview } from '../store';
import type { DiffFile as DiffFileType } from '../types';
import { DiffFile } from './DiffFile';

export function DiffViewer({ files }: { files: DiffFileType[] }) {
  const { selection, setSelection, dragging, setDragging, setDraft } = useReview();

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
    <main className="diff-viewer">
      {files.map((file) => (
        <DiffFile key={`${file.oldPath}→${file.newPath}`} file={file} />
      ))}
    </main>
  );
}
