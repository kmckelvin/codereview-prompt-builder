import type { DiffFile } from './types';

/**
 * Sort files the way the file tree presents them: at each directory level,
 * subdirectories first (alphabetical), then files (alphabetical). The diff
 * viewer renders in this order too, so both panes always agree.
 */
export function sortFilesTreeOrder(files: DiffFile[]): DiffFile[] {
  return [...files].sort((fa, fb) => {
    const a = fa.newPath.split('/');
    const b = fb.newPath.split('/');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length) return -1;
      if (i >= b.length) return 1;
      const aIsDir = i < a.length - 1;
      const bIsDir = i < b.length - 1;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      const c = a[i].localeCompare(b[i]);
      if (c !== 0) return c;
    }
    return 0;
  });
}
