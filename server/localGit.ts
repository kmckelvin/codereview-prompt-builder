import { execFile } from 'node:child_process';
import type { RawDiff } from './glab';

export interface LocalRef {
  repoPath: string;
  base: string;
  head: string;
  /** verbatim range like "master..feature" if the user gave one; otherwise merge-base semantics (base...head) */
  range: string | null;
}

export function git(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.join(' ')} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

export async function defaultBranch(repoPath: string): Promise<string> {
  try {
    const ref = (await git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
    if (ref) return ref; // e.g. "origin/main"
  } catch {
    // no origin/HEAD ref; fall through to local conventions
  }
  for (const name of ['main', 'master']) {
    try {
      await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
      return name;
    } catch {
      // try next
    }
  }
  throw new Error('Could not determine the default branch; pass --base explicitly.');
}

export interface RepoInfo {
  repoPath: string;
  branches: string[];
  currentBranch: string;
  defaultBranch: string;
}

/** Branch listing for the start screen's local-repo picker. */
export async function repoInfo(repoPath: string): Promise<RepoInfo> {
  await git(repoPath, ['rev-parse', '--git-dir']); // fails fast if not a git repo
  const branches = (await git(repoPath, ['for-each-ref', 'refs/heads', '--format=%(refname:short)']))
    .trim()
    .split('\n')
    .filter(Boolean);
  const currentBranch = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  let def: string;
  try {
    def = await defaultBranch(repoPath);
  } catch {
    def = branches[0] ?? '';
  }
  return { repoPath, branches, currentBranch, defaultBranch: def };
}

export async function resolveLocalRef(
  repoPath: string,
  baseArg: string,
  headArg: string,
  rangeArg: string,
): Promise<LocalRef> {
  await git(repoPath, ['rev-parse', '--git-dir']); // fails fast if not a git repo
  if (rangeArg) {
    const [base, head] = rangeArg.split(/\.{2,3}/);
    if (!base || !head) throw new Error(`Not a valid diff range: ${rangeArg}`);
    return { repoPath, base, head, range: rangeArg };
  }
  const head = headArg || (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const base = baseArg || (await defaultBranch(repoPath));
  return { repoPath, base, head, range: null };
}

/** Parse one `diff --git` block's header lines into paths and status flags. */
function parseFileHeader(headerLines: string[]): Omit<RawDiff, 'diff'> {
  let oldPath = '';
  let newPath = '';
  let newFile = false;
  let deletedFile = false;
  let renamedFile = false;
  for (const line of headerLines) {
    if (line.startsWith('rename from ')) {
      oldPath = line.slice('rename from '.length);
      renamedFile = true;
    } else if (line.startsWith('rename to ')) {
      newPath = line.slice('rename to '.length);
    } else if (line.startsWith('new file mode')) {
      newFile = true;
    } else if (line.startsWith('deleted file mode')) {
      deletedFile = true;
    } else if (line.startsWith('--- ') && !oldPath) {
      const p = line.slice(4).trim();
      oldPath = p === '/dev/null' ? '' : p.replace(/^"?a\//, '').replace(/"$/, '');
    } else if (line.startsWith('+++ ') && !newPath) {
      const p = line.slice(4).trim();
      newPath = p === '/dev/null' ? '' : p.replace(/^"?b\//, '').replace(/"$/, '');
    }
  }
  return {
    old_path: oldPath || newPath,
    new_path: newPath || oldPath,
    new_file: newFile,
    deleted_file: deletedFile,
    renamed_file: renamedFile,
  };
}

/** Split raw `git diff` output into per-file blocks on "diff --git" boundaries. */
export function parseGitDiffOutput(out: string): RawDiff[] {
  const files: RawDiff[] = [];
  for (const block of out.split(/^(?=diff --git )/m)) {
    if (!block.startsWith('diff --git ')) continue;
    const lines = block.split('\n');
    const firstHunk = lines.findIndex((l) => l.startsWith('@@ '));
    const headerLines = firstHunk === -1 ? lines : lines.slice(0, firstHunk);
    const diff = firstHunk === -1 ? '' : lines.slice(firstHunk).join('\n');
    files.push({ ...parseFileHeader(headerLines), diff });
  }
  return files;
}

export async function fetchLocalDiffs(ref: LocalRef): Promise<RawDiff[]> {
  const range = ref.range ?? `${ref.base}...${ref.head}`;
  return parseGitDiffOutput(await git(ref.repoPath, ['diff', '--no-color', '--find-renames', range]));
}

export function fetchLocalFile(ref: LocalRef, path: string): Promise<string> {
  return git(ref.repoPath, ['show', `${ref.head}:${path}`]);
}
