#!/usr/bin/env node
// Launcher:
//   npm start -- <gitlab-mr-url>
//   npm start -- <repo-path> [base..head]
//   npm start -- <repo-path> --base master --head my-branch
//
// In repo mode, --head defaults to the currently checked-out branch and
// --base to the repo's default branch. Flags compare via merge-base
// (base...head, like an MR); an explicit range is passed to git verbatim.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const usage = () => {
  console.error('Usage:');
  console.error('  npm start -- https://gitlab.com/group/repo/-/merge_requests/123');
  console.error('  npm start -- /path/to/repo [master..feature]');
  console.error('  npm start -- /path/to/repo --base master --head feature');
  process.exit(1);
};

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' || args[i] === '--head' || args[i] === '--repo') {
    const value = args[++i];
    if (!value) usage();
    flags[args[i - 1].slice(2)] = value;
  } else {
    positional.push(args[i]);
  }
}

const env = { ...process.env };
const target = flags.repo ?? positional.shift();

if (target && /^https?:\/\//.test(target)) {
  if (!/\/-\/merge_requests\/\d+/.test(target)) usage();
  env.MR_URL = target;
} else if (target) {
  const repoPath = resolve(target);
  if (!existsSync(repoPath)) {
    console.error(`No such directory: ${repoPath}`);
    process.exit(1);
  }
  env.REPO_PATH = repoPath;
  const range = positional.shift();
  if (range) {
    if (!/\.{2,3}/.test(range)) usage();
    env.GIT_RANGE = range;
  }
  if (flags.base) env.GIT_BASE = flags.base;
  if (flags.head) env.GIT_HEAD = flags.head;
} else {
  usage();
}

const child = spawn('npx', ['vite', '--open'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
