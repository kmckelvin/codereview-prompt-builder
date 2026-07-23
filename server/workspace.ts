import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { RawDiff } from './glab';
import { defaultBranch, git, parseGitDiffOutput } from './localGit';

export interface WorkspaceRepo {
  name: string;
  branch: string;
  /** What the working tree is diffed against: the default branch, or HEAD when there is none. */
  baseRef: string;
  changedFiles: number;
}

export interface WorkspaceInfo {
  rootPath: string;
  repos: WorkspaceRepo[];
}

/** Workspace options from `.codereview.json` at the workspace root. */
interface WorkspaceConfig {
  /** Repo names to leave out of the workspace entirely. */
  skip: Set<string>;
}

async function workspaceConfig(rootPath: string): Promise<WorkspaceConfig> {
  try {
    const parsed = JSON.parse(await readFile(join(rootPath, '.codereview.json'), 'utf8'));
    const skip = Array.isArray(parsed.skip) ? parsed.skip.filter((s: unknown) => typeof s === 'string') : [];
    return { skip: new Set(skip) };
  } catch {
    return { skip: new Set() };
  }
}

/** Direct child directories that are git repos (`.git` dir or file), minus skipped ones, sorted by name. */
async function childRepos(rootPath: string): Promise<string[]> {
  const [entries, config] = await Promise.all([
    readdir(rootPath, { withFileTypes: true }),
    workspaceConfig(rootPath),
  ]);
  const candidates = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith('.') && !config.skip.has(e.name),
  );
  const names = await Promise.all(
    candidates.map(async (e) => {
      try {
        await stat(join(rootPath, e.name, '.git'));
        return e.name;
      } catch {
        return null;
      }
    }),
  );
  return names.filter((n): n is string => n !== null).sort((a, b) => a.localeCompare(b));
}

interface RepoRef {
  branch: string;
  baseRef: string;
  /** Commit the working tree is diffed against (merge-base of baseRef and HEAD). */
  mergeBase: string;
}

async function repoRef(repoPath: string): Promise<RepoRef> {
  const [branch, baseRef] = await Promise.all([
    git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).then((s) => s.trim()),
    defaultBranch(repoPath).catch(() => 'HEAD'),
  ]);
  // On the default branch the merge-base is HEAD by definition — skip the git
  // call and diff the working tree against HEAD directly.
  const onDefault = baseRef === branch || baseRef === `origin/${branch}`;
  const mergeBase =
    baseRef === 'HEAD' || onDefault ? 'HEAD' : (await git(repoPath, ['merge-base', baseRef, 'HEAD'])).trim();
  return { branch, baseRef, mergeBase };
}

async function untrackedFiles(repoPath: string): Promise<string[]> {
  return (await git(repoPath, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean);
}

/** Synthesize an added-file diff for an untracked file (git diff doesn't include them). */
async function untrackedDiff(repoPath: string, path: string): Promise<RawDiff> {
  const abs = join(repoPath, path);
  const empty = { old_path: path, new_path: path, new_file: true, deleted_file: false, renamed_file: false };
  // Don't inline enormous untracked files; list them without content.
  if ((await stat(abs)).size > 2 * 1024 * 1024) return { ...empty, diff: '' };
  const buf = await readFile(abs);
  const isBinary = buf.subarray(0, 8000).includes(0);
  let diff = '';
  if (!isBinary && buf.length > 0) {
    const lines = buf.toString('utf8').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    diff = `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`;
  }
  return { ...empty, diff };
}

/**
 * Cheap per-repo change summary for the start screen: file counts only.
 * Repos that can't be diffed (e.g. no commits yet) are skipped.
 */
export async function workspaceInfo(rootPath: string): Promise<WorkspaceInfo> {
  const names = await childRepos(rootPath);
  const repos = await Promise.all(
    names.map(async (name): Promise<WorkspaceRepo | null> => {
      const repoPath = join(rootPath, name);
      try {
        const untrackedP = untrackedFiles(repoPath);
        const ref = await repoRef(repoPath);
        const [changed, untracked] = await Promise.all([
          git(repoPath, ['diff', '--name-only', '--find-renames', ref.mergeBase]),
          untrackedP,
        ]);
        const changedFiles = changed.split('\n').filter(Boolean).length + untracked.length;
        return { name, branch: ref.branch, baseRef: ref.baseRef, changedFiles };
      } catch {
        return null;
      }
    }),
  );
  return { rootPath, repos: repos.filter((r): r is WorkspaceRepo => r !== null) };
}

/**
 * Full diffs for every changed child repo, with paths prefixed `repoName/` so
 * repos become top-level folders in the review. Each repo's working tree is
 * diffed against the merge-base of its default branch and HEAD, which covers
 * both uncommitted changes and committed branch work; untracked files are
 * included as added files.
 */
export async function fetchWorkspaceDiffs(rootPath: string): Promise<{ repos: WorkspaceRepo[]; diffs: RawDiff[] }> {
  const names = await childRepos(rootPath);
  if (names.length === 0) throw new Error(`No git repositories found directly inside ${rootPath}`);
  const perRepo = await Promise.all(
    names.map(async (name): Promise<{ repo: WorkspaceRepo; diffs: RawDiff[] } | null> => {
      const repoPath = join(rootPath, name);
      try {
        const untrackedP = untrackedFiles(repoPath);
        const ref = await repoRef(repoPath);
        const [out, untracked] = await Promise.all([
          git(repoPath, ['diff', '--no-color', '--find-renames', ref.mergeBase]),
          untrackedP,
        ]);
        const fileDiffs = [
          ...parseGitDiffOutput(out),
          ...(await Promise.all(untracked.map((f) => untrackedDiff(repoPath, f)))),
        ];
        return {
          repo: { name, branch: ref.branch, baseRef: ref.baseRef, changedFiles: fileDiffs.length },
          diffs: fileDiffs.map((d) => ({ ...d, old_path: `${name}/${d.old_path}`, new_path: `${name}/${d.new_path}` })),
        };
      } catch {
        return null;
      }
    }),
  );
  const ok = perRepo.filter((r): r is NonNullable<typeof r> => r !== null);
  return { repos: ok.map((r) => r.repo), diffs: ok.flatMap((r) => r.diffs) };
}

/** Working-tree file content for a `repoName/path` workspace path. */
export function fetchWorkspaceFile(rootPath: string, path: string): Promise<string> {
  const abs = resolve(rootPath, path);
  if (!abs.startsWith(resolve(rootPath) + sep)) throw new Error(`Path escapes the workspace: ${path}`);
  return readFile(abs, 'utf8');
}
