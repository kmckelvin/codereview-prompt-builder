import react from '@vitejs/plugin-react';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { defineConfig } from 'vite';
import { pickDirectory } from './server/dialog';
import { parseUnifiedDiff } from './server/diff';
import { fetchGitHubData, fetchGitHubFile, parseGitHubUrl } from './server/github';
import { fetchMRDiffs, fetchMRInfo, fetchRawFile, parseMRUrl, type MRInfo, type RawDiff } from './server/glab';
import { loadHistory, recordHistory } from './server/history';
import { fetchLocalDiffs, fetchLocalFile, repoInfo, resolveLocalRef } from './server/localGit';
import { loadState, saveState } from './server/persist';

export type Target =
  | { kind: 'gitlab'; url: string }
  | { kind: 'github'; url: string }
  | { kind: 'local'; repoPath: string; base?: string; head?: string; range?: string };

interface Provider {
  load(): Promise<{ info: MRInfo; files: unknown[] }>;
  fileContent(path: string): Promise<string>;
  stateKey(): Promise<string>;
}

function toFiles(rawDiffs: RawDiff[]) {
  return rawDiffs.map((d) => ({
    oldPath: d.old_path,
    newPath: d.new_path,
    status: d.new_file ? 'added' : d.deleted_file ? 'deleted' : d.renamed_file ? 'renamed' : 'modified',
    hunks: parseUnifiedDiff(d.diff),
  }));
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');
const expandHome = (p: string) => (p.startsWith('~/') || p === '~' ? join(homedir(), p.slice(1)) : p);

function mrProvider(mrUrl: string): Provider {
  const ref = parseMRUrl(mrUrl);
  let info: MRInfo | null = null;
  const getInfo = async () => (info ??= await fetchMRInfo(ref));
  return {
    async load() {
      const [i, rawDiffs] = await Promise.all([getInfo(), fetchMRDiffs(ref)]);
      return { info: i, files: toFiles(rawDiffs) };
    },
    async fileContent(path) {
      const i = await getInfo();
      if (!i.headSha) throw new Error('MR has no head SHA to fetch file contents from');
      return fetchRawFile(ref, path, i.headSha);
    },
    async stateKey() {
      return `${ref.host}/${ref.projectPath}/${ref.iid}.json`;
    },
  };
}

function githubProvider(url: string): Provider {
  const ref = parseGitHubUrl(url);
  let headSha: string | null = null;
  return {
    async load() {
      const { info, diffs } = await fetchGitHubData(ref);
      headSha = info.headSha;
      return { info, files: toFiles(diffs) };
    },
    async fileContent(path) {
      if (!headSha) headSha = (await fetchGitHubData(ref)).info.headSha;
      if (!headSha) throw new Error('No head SHA to fetch file contents from');
      return fetchGitHubFile(ref, path, headSha);
    },
    async stateKey() {
      const name = ref.kind === 'pr' ? `pr-${ref.number}` : `compare-${sanitize(ref.range)}`;
      return `${ref.host}/${ref.owner}/${ref.repo}/${name}.json`;
    },
  };
}

function localProvider(repoPath: string, base: string, head: string, range: string): Provider {
  const refPromise = resolveLocalRef(repoPath, base, head, range);
  return {
    async load() {
      const ref = await refPromise;
      const rangeLabel = ref.range ?? `${ref.base}...${ref.head}`;
      const info: MRInfo = {
        title: `${basename(ref.repoPath)}: ${rangeLabel}`,
        author: '',
        webUrl: null,
        sourceBranch: ref.head,
        targetBranch: ref.base,
        state: '',
        headSha: null,
        promptHeader: `Repo: ${ref.repoPath} (${rangeLabel})`,
      };
      return { info, files: toFiles(await fetchLocalDiffs(ref)) };
    },
    async fileContent(path) {
      return fetchLocalFile(await refPromise, path);
    },
    async stateKey() {
      const ref = await refPromise;
      return `local${ref.repoPath}/${sanitize(ref.range ?? `${ref.base}...${ref.head}`)}.json`;
    },
  };
}

function providerFor(target: Target): Provider {
  switch (target.kind) {
    case 'gitlab':
      return mrProvider(target.url);
    case 'github':
      return githubProvider(target.url);
    case 'local':
      return localProvider(
        resolve(expandHome(target.repoPath)),
        target.base ?? '',
        target.head ?? '',
        target.range ?? '',
      );
    default:
      throw new Error(`Unknown target kind: ${(target as { kind?: string }).kind}`);
  }
}

function bootTarget(): Target | null {
  if (process.env.MR_URL) return { kind: 'gitlab', url: process.env.MR_URL };
  if (process.env.GITHUB_URL) return { kind: 'github', url: process.env.GITHUB_URL };
  if (process.env.REPO_PATH) {
    return {
      kind: 'local',
      repoPath: process.env.REPO_PATH,
      base: process.env.GIT_BASE || undefined,
      head: process.env.GIT_HEAD || undefined,
      range: process.env.GIT_RANGE || undefined,
    };
  }
  return null;
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function apiPlugin(): Plugin {
  interface Entry {
    provider: Provider;
    fileCache: Map<string, Promise<string>>;
  }
  const entries = new Map<string, Entry>();

  const freshEntry = (target: Target): Entry => {
    const entry = { provider: providerFor(target), fileCache: new Map<string, Promise<string>>() };
    entries.set(JSON.stringify(target), entry);
    return entry;
  };

  const entryFor = (target: Target): Entry => entries.get(JSON.stringify(target)) ?? freshEntry(target);

  const targetFromQuery = (url: string): Target => {
    const t = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('t');
    if (!t) throw new Error('missing target');
    return JSON.parse(t);
  };

  return {
    name: 'codereview-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        const send = (status: number, body: string) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(body);
        };
        try {
          if (req.url === '/boot' && req.method === 'GET') {
            send(200, JSON.stringify({ target: bootTarget() }));
          } else if (req.url === '/history' && req.method === 'GET') {
            send(200, JSON.stringify(await loadHistory()));
          } else if (req.url === '/pick-directory' && req.method === 'POST') {
            send(200, JSON.stringify({ path: await pickDirectory() }));
          } else if (req.url === '/repo-info' && req.method === 'POST') {
            const { repoPath } = JSON.parse(await readBody(req));
            if (!repoPath) {
              send(400, '{"error":"missing repoPath"}');
              return;
            }
            send(200, JSON.stringify(await repoInfo(resolve(expandHome(repoPath)))));
          } else if (req.url === '/mr' && req.method === 'POST') {
            const { target } = JSON.parse(await readBody(req)) as { target: Target };
            // Always load fresh (with a fresh provider, so the head SHA and
            // file contents refresh too) — a page reload should pick up
            // commits pushed to the MR/PR/branch since the last view.
            const entry = freshEntry(target);
            const loaded = await entry.provider.load();
            const info = loaded.info;
            // For local targets, store the resolved branches so reopening
            // from history pins the same comparison.
            const canonical: Target =
              target.kind === 'local' && !target.range
                ? { kind: 'local', repoPath: target.repoPath, base: info.targetBranch, head: info.sourceBranch }
                : target;
            await recordHistory({
              target: canonical,
              title: info.title,
              subtitle: info.promptHeader.replace(/^[^ ]+ /, ''),
              openedAt: Date.now(),
            });
            send(200, JSON.stringify(loaded));
          } else if (req.url?.startsWith('/file?') && req.method === 'GET') {
            const params = new URLSearchParams(req.url.slice('/file?'.length));
            const path = params.get('path');
            if (!path) {
              send(400, '{"error":"missing path"}');
              return;
            }
            const entry = entryFor(targetFromQuery(req.url));
            if (!entry.fileCache.has(path)) {
              entry.fileCache.set(path, entry.provider.fileContent(path));
            }
            try {
              send(200, JSON.stringify({ content: await entry.fileCache.get(path) }));
            } catch (e) {
              entry.fileCache.delete(path);
              throw e;
            }
          } else if (req.url?.startsWith('/state?') && req.method === 'GET') {
            const entry = entryFor(targetFromQuery(req.url));
            send(200, await loadState(await entry.provider.stateKey()));
          } else if (req.url?.startsWith('/state?') && req.method === 'PUT') {
            const entry = entryFor(targetFromQuery(req.url));
            await saveState(await entry.provider.stateKey(), await readBody(req));
            send(200, '{"ok":true}');
          } else {
            send(404, '{"error":"not found"}');
          }
        } catch (e) {
          send(500, JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
});
