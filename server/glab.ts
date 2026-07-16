import { execFile } from 'node:child_process';

export interface MRRef {
  host: string;
  projectPath: string;
  iid: number;
}

export function parseMRUrl(url: string): MRRef {
  const u = new URL(url);
  const m = u.pathname.match(/^\/(.+?)\/-\/merge_requests\/(\d+)/);
  if (!m) throw new Error(`Not a GitLab MR URL: ${url}`);
  return { host: u.host, projectPath: m[1], iid: Number(m[2]) };
}

function glabApi(ref: MRRef, endpoint: string, paginate = false): Promise<string> {
  const args = ['api', '--hostname', ref.host];
  if (paginate) args.push('--paginate');
  args.push(endpoint);
  return new Promise((resolve, reject) => {
    execFile('glab', args, { maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`glab api ${endpoint} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

export interface MRInfo {
  title: string;
  author: string;
  webUrl: string | null;
  sourceBranch: string;
  targetBranch: string;
  state: string;
  headSha: string | null;
  /** First line of the copied prompt, e.g. "MR: https://…" or "Repo: /path (base...head)" */
  promptHeader: string;
}

export async function fetchMRInfo(ref: MRRef): Promise<MRInfo> {
  const base = `projects/${encodeURIComponent(ref.projectPath)}/merge_requests/${ref.iid}`;
  const raw = JSON.parse(await glabApi(ref, base));
  return {
    title: raw.title,
    author: raw.author?.name ?? '',
    webUrl: raw.web_url,
    sourceBranch: raw.source_branch,
    targetBranch: raw.target_branch,
    state: raw.state,
    headSha: raw.diff_refs?.head_sha ?? raw.sha ?? null,
    promptHeader: `MR: ${raw.web_url}`,
  };
}

export interface RawDiff {
  old_path: string;
  new_path: string;
  new_file: boolean;
  deleted_file: boolean;
  renamed_file: boolean;
  diff: string;
}

export async function fetchMRDiffs(ref: MRRef): Promise<RawDiff[]> {
  const base = `projects/${encodeURIComponent(ref.projectPath)}/merge_requests/${ref.iid}`;
  const out = await glabApi(ref, `${base}/diffs?per_page=100`, true);
  // --paginate can emit concatenated JSON arrays ("][") across pages
  return JSON.parse(out.replaceAll('][', ','));
}

export function fetchRawFile(ref: MRRef, path: string, sha: string): Promise<string> {
  const endpoint = `projects/${encodeURIComponent(ref.projectPath)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(sha)}`;
  return glabApi(ref, endpoint);
}
