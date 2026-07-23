import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiffFile, ReviewComment } from '../types';

interface Props {
  files: DiffFile[];
  comments: ReviewComment[];
  activeFile: string | null;
  /** Start top-level directories collapsed (workspace mode: one root per repo). */
  collapseRoots?: boolean;
}

interface TreeDir {
  name: string;
  path: string;
  dirs: Map<string, TreeDir>;
  files: DiffFile[];
}

function buildTree(files: DiffFile[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.newPath.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = { name: part, path: dir.path ? `${dir.path}/${part}` : part, dirs: new Map(), files: [] };
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    dir.files.push(file);
  }
  return root;
}

/** Collapse chains of single-child directories: a/b/c → one node "a/b/c" */
function compact(dir: TreeDir): TreeDir {
  const dirs = new Map<string, TreeDir>();
  for (let child of dir.dirs.values()) {
    child = compact(child);
    while (child.dirs.size === 1 && child.files.length === 0) {
      const only: TreeDir = child.dirs.values().next().value!;
      child = { ...only, name: `${child.name}/${only.name}` };
    }
    dirs.set(child.name, child);
  }
  return { ...dir, dirs };
}

const STATUS_BADGE: Record<DiffFile['status'], string> = {
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  modified: 'M',
};

export function fileAnchorId(path: string): string {
  return `file-${path.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function FileRow({ file, count, active }: { file: DiffFile; count: number; active: boolean }) {
  const name = file.newPath.split('/').pop();
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <li>
      <a
        ref={ref}
        className={`tree-file${active ? ' active' : ''}`}
        href={`#${fileAnchorId(file.newPath)}`}
        onClick={(e) => {
          e.preventDefault();
          document.getElementById(fileAnchorId(file.newPath))?.scrollIntoView({ block: 'start' });
        }}
        title={file.newPath}
      >
        <span className={`status status-${file.status}`}>{STATUS_BADGE[file.status]}</span>
        <span className="tree-file-name">{name}</span>
        {count > 0 && <span className="comment-badge">{count}</span>}
      </a>
    </li>
  );
}

interface LevelProps {
  counts: Map<string, number>;
  activeFile: string | null;
  /** Whether this level's directory nodes start open; nested levels always do. */
  dirsDefaultOpen?: boolean;
}

function DirNode({ dir, counts, activeFile, defaultOpen }: LevelProps & { dir: TreeDir; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li>
      <button className="tree-dir" onClick={() => setOpen(!open)}>
        <span className={`chevron ${open ? 'open' : ''}`}>▸</span>
        {dir.name}
      </button>
      {open && <TreeLevel dir={dir} counts={counts} activeFile={activeFile} />}
    </li>
  );
}

// Files arrive pre-sorted in tree order (see fileOrder.ts), so Map insertion
// order and array order are already correct — no re-sorting here, keeping the
// tree and the diff pane in exactly the same order.
function TreeLevel({ dir, counts, activeFile, dirsDefaultOpen = true }: LevelProps & { dir: TreeDir }) {
  const sortedDirs = [...dir.dirs.values()];
  const sortedFiles = dir.files;
  return (
    <ul className="tree-level">
      {sortedDirs.map((d) => (
        <DirNode key={d.path} dir={d} counts={counts} activeFile={activeFile} defaultOpen={dirsDefaultOpen} />
      ))}
      {sortedFiles.map((f) => (
        <FileRow key={f.newPath} file={f} count={counts.get(f.newPath) ?? 0} active={f.newPath === activeFile} />
      ))}
    </ul>
  );
}

export function FileTree({ files, comments, activeFile, collapseRoots = false }: Props) {
  const tree = useMemo(() => compact(buildTree(files)), [files]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of comments) map.set(c.file, (map.get(c.file) ?? 0) + 1);
    return map;
  }, [comments]);

  return (
    <nav className="file-tree">
      <div className="file-tree-header">
        {files.length} file{files.length === 1 ? '' : 's'} changed
      </div>
      <TreeLevel dir={tree} counts={counts} activeFile={activeFile} dirsDefaultOpen={!collapseRoots} />
    </nav>
  );
}
