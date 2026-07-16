import react from '@vitejs/plugin-react';
import { basename } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { defineConfig } from 'vite';
import { parseUnifiedDiff } from './server/diff';
import { fetchMRDiffs, fetchMRInfo, fetchRawFile, parseMRUrl, type MRInfo, type RawDiff } from './server/glab';
import { fetchLocalDiffs, fetchLocalFile, resolveLocalRef } from './server/localGit';
import { loadState, saveState } from './server/persist';

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

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function apiPlugin(): Plugin {
  const provider: Provider | null = process.env.MR_URL
    ? mrProvider(process.env.MR_URL)
    : process.env.REPO_PATH
      ? localProvider(
          process.env.REPO_PATH,
          process.env.GIT_BASE ?? '',
          process.env.GIT_HEAD ?? '',
          process.env.GIT_RANGE ?? '',
        )
      : null;
  let mrCache: string | null = null;
  const fileCache = new Map<string, Promise<string>>();

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
          if (!provider) {
            send(400, JSON.stringify({ error: 'No review target. Launch with: npm start -- <mr-url | repo-path>' }));
            return;
          }

          if (req.url === '/mr' && req.method === 'GET') {
            mrCache ??= JSON.stringify(await provider.load());
            send(200, mrCache);
          } else if (req.url?.startsWith('/file?') && req.method === 'GET') {
            const path = new URLSearchParams(req.url.slice('/file?'.length)).get('path');
            if (!path) {
              send(400, '{"error":"missing path"}');
              return;
            }
            if (!fileCache.has(path)) {
              fileCache.set(path, provider.fileContent(path));
            }
            try {
              send(200, JSON.stringify({ content: await fileCache.get(path) }));
            } catch (e) {
              fileCache.delete(path);
              throw e;
            }
          } else if (req.url === '/state' && req.method === 'GET') {
            send(200, await loadState(await provider.stateKey()));
          } else if (req.url === '/state' && req.method === 'PUT') {
            await saveState(await provider.stateKey(), await readBody(req));
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
