import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchBoot, fetchMR, fetchState, saveState, setApiTarget } from './api';
import { DiffViewer } from './components/DiffViewer';
import { FileTree } from './components/FileTree';
import { ImportDialog } from './components/ImportDialog';
import { StartScreen } from './components/StartScreen';
import { Toolbar } from './components/Toolbar';
import { sortFilesTreeOrder } from './fileOrder';
import { newCommentId } from './promptFormat';
import type { Draft, ViewMode } from './store';
import { ReviewProvider, type ReviewStore } from './store';
import type { MRData, ReviewComment, Selection, Target } from './types';

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

// The open review is deep-linked in the URL hash so refresh (and browser
// back/forward) restore it.
function targetFromHash(): Target | null {
  const m = window.location.hash.match(/^#t=(.+)$/);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
}

function hashForTarget(target: Target | null): string {
  return target ? `#t=${encodeURIComponent(JSON.stringify(target))}` : '';
}

export function App() {
  const [target, setTarget] = useState<Target | null>(targetFromHash);
  const [booted, setBooted] = useState(
    () => targetFromHash() !== null || !!sessionStorage.getItem('skip-boot-target'),
  );

  const openTarget = useCallback((t: Target | null) => {
    const hash = hashForTarget(t);
    if (window.location.hash !== hash && !(hash === '' && window.location.hash === '#')) {
      window.location.hash = hash;
    }
    setTarget(t);
  }, []);

  // Follow manual hash edits and browser back/forward
  useEffect(() => {
    const onHashChange = () => setTarget(targetFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    // A CLI-supplied target boots straight into the review — unless a deep
    // link or an explicit return to the start screen takes precedence.
    if (booted) return;
    fetchBoot().then(
      (b) => {
        if (b.target) openTarget(b.target);
        setBooted(true);
      },
      () => setBooted(true),
    );
  }, [booted, openTarget]);

  if (!booted) {
    return <div className="fullscreen-message"><p className="loading">Loading…</p></div>;
  }
  if (!target) {
    return <StartScreen onOpen={openTarget} />;
  }
  return (
    <ReviewView
      key={JSON.stringify(target)}
      target={target}
      onBack={() => {
        sessionStorage.setItem('skip-boot-target', '1');
        openTarget(null);
      }}
    />
  );
}

function ReviewView({ target, onBack }: { target: Target; onBack: () => void }) {
  setApiTarget(target);
  const [mr, setMR] = useState<MRData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const [importOpen, setImportOpen] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);
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

  const files = useMemo(() => (mr ? sortFilesTreeOrder(mr.files) : []), [mr]);

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
      promptHeader: mr?.info.promptHeader ?? '',
    }),
    [comments, addComment, updateComment, deleteComment, selection, dragging, draft, viewMode, dark, mr],
  );

  if (error) {
    return (
      <div className="fullscreen-message">
        <h1>Couldn&rsquo;t load review</h1>
        <pre>{error}</pre>
        <p>
          <button className="btn" onClick={onBack}>
            ← Back
          </button>
        </p>
      </div>
    );
  }
  if (!mr) {
    return <div className="fullscreen-message"><p className="loading">Fetching diff…</p></div>;
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
          onBack={onBack}
        />
        <div className="app-body">
          <FileTree
            files={files}
            comments={comments}
            activeFile={activeFile}
            collapseRoots={target.kind === 'workspace'}
          />
          <DiffViewer files={files} onActiveFile={setActiveFile} />
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
