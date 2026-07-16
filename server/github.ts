import { execFile } from 'node:child_process';
import type { MRInfo, RawDiff } from './glab';

export type GitHubRef =
  | { kind: 'pr'; host: string; owner: string; repo: string; number: number }
  | { kind: 'compare'; host: string; owner: string; repo: string; range: string };

export function parseGitHubUrl(url: string): GitHubRef {
  const u = new URL(url);
  const pr = u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (pr) return { kind: 'pr', host: u.host, owner: pr[1], repo: pr[2], number: Number(pr[3]) };
  const cmp = u.pathname.match(/^\/([^/]+)\/([^/]+)\/compare\/(.+)/);
  if (cmp) return { kind: 'compare', host: u.host, owner: cmp[1], repo: cmp[2], range: decodeURIComponent(cmp[3]) };
  throw new Error(`Not a GitHub PR or compare URL: ${url}`);
}

function ghApi(ref: GitHubRef, endpoint: string, extraArgs: string[] = []): Promise<string> {
  const args = ['api', '--hostname', ref.host, ...extraArgs, endpoint];
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`gh api ${endpoint} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

/** GitHub "files" entries (same shape for PR files and compare files). */
interface GHFile {
  filename: string;
  previous_filename?: string;
  status: string; // added | removed | modified | renamed | copied | changed | unchanged
  patch?: string;
}

function toRawDiffs(files: GHFile[]): RawDiff[] {
  return files.map((f) => ({
    old_path: f.previous_filename ?? f.filename,
    new_path: f.filename,
    new_file: f.status === 'added',
    deleted_file: f.status === 'removed',
    renamed_file: f.status === 'renamed',
    diff: f.patch ?? '',
  }));
}

export async function fetchGitHubData(ref: GitHubRef): Promise<{ info: MRInfo; diffs: RawDiff[] }> {
  const repo = `repos/${ref.owner}/${ref.repo}`;
  if (ref.kind === 'pr') {
    const [prRaw, filesRaw] = await Promise.all([
      ghApi(ref, `${repo}/pulls/${ref.number}`),
      ghApi(ref, `${repo}/pulls/${ref.number}/files?per_page=100`, ['--paginate']),
    ]);
    const pr = JSON.parse(prRaw);
    const files: GHFile[] = JSON.parse(filesRaw.replaceAll('][', ','));
    return {
      info: {
        title: pr.title,
        author: pr.user?.login ?? '',
        webUrl: pr.html_url,
        sourceBranch: pr.head?.ref ?? '',
        targetBranch: pr.base?.ref ?? '',
        state: pr.state,
        headSha: pr.head?.sha ?? null,
        promptHeader: `PR: ${pr.html_url}`,
      },
      diffs: toRawDiffs(files),
    };
  }

  const cmp = JSON.parse(await ghApi(ref, `${repo}/compare/${encodeURIComponent(ref.range)}?per_page=100`));
  const [base, head] = ref.range.split(/\.{2,3}/);
  return {
    info: {
      title: `${ref.owner}/${ref.repo}: ${ref.range}`,
      author: '',
      webUrl: cmp.html_url,
      sourceBranch: head ?? '',
      targetBranch: base ?? '',
      state: '',
      headSha: cmp.commits?.length ? cmp.commits[cmp.commits.length - 1].sha : null,
      promptHeader: `Compare: ${cmp.html_url}`,
    },
    diffs: toRawDiffs(cmp.files ?? []),
  };
}

export function fetchGitHubFile(ref: GitHubRef, path: string, sha: string): Promise<string> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return ghApi(ref, `repos/${ref.owner}/${ref.repo}/contents/${encodedPath}?ref=${encodeURIComponent(sha)}`, [
    '-H',
    'Accept: application/vnd.github.raw+json',
  ]);
}
