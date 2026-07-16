import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMR, fetchState, saveState } from './api';
import { DiffViewer } from './components/DiffViewer';
import { FileTree } from './components/FileTree';
import { ImportDialog } from './components/ImportDialog';
import { Toolbar } from './components/Toolbar';
import { newCommentId } from './promptFormat';
import type { Draft, ViewMode } from './store';
import { ReviewProvider, type ReviewStore } from './store';
import type { MRData, ReviewComment, Selection } from './types';

function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

export function App() {
  const [mr, setMR] = useState<MRData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const [importOpen, setImportOpen] = useState(false);
  const dark = useDarkMode();

  useEffect(() => {
    fetchMR().then(setMR, (e) => setError(e.message));
    fetchState().then(
      (s) => {
        setComments(s.comments ?? []);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, []);

  // Debounced auto-persist
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveState(comments), 400);
    return () => window.clearTimeout(saveTimer.current);
  }, [comments, loaded]);

  const addComment = useCallback((c: Omit<ReviewComment, 'id'>) => {
    setComments((prev) => [...prev, { ...c, id: newCommentId() }]);
  }, []);
  const updateComment = useCallback((id: string, body: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, body } : c)));
  }, []);
  const deleteComment = useCallback((id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const store: ReviewStore = useMemo(
    () => ({
      comments,
      addComment,
      updateComment,
      deleteComment,
      selection,
      setSelection,
      dragging,
      setDragging,
      draft,
      setDraft,
      viewMode,
      dark,
    }),
    [comments, addComment, updateComment, deleteComment, selection, dragging, draft, viewMode, dark],
  );

  if (error) {
    return (
      <div className="fullscreen-message">
        <h1>Couldn&rsquo;t load merge request</h1>
        <pre>{error}</pre>
      </div>
    );
  }
  if (!mr) {
    return <div className="fullscreen-message"><p className="loading">Fetching merge request…</p></div>;
  }

  return (
    <ReviewProvider value={store}>
      <div className="app">
        <Toolbar
          info={mr.info}
          viewMode={viewMode}
          onViewMode={setViewMode}
          commentCount={comments.length}
          onImport={() => setImportOpen(true)}
          onClear={() => {
            setComments([]);
            setDraft(null);
            setSelection(null);
          }}
        />
        <div className="app-body">
          <FileTree files={mr.files} comments={comments} />
          <DiffViewer files={mr.files} />
        </div>
        {importOpen && (
          <ImportDialog
            hasComments={comments.length > 0}
            onClose={() => setImportOpen(false)}
            onImport={(imported) => {
              setComments(imported);
              setImportOpen(false);
            }}
          />
        )}
      </div>
    </ReviewProvider>
  );
}
