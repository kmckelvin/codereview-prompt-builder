import type { HighlighterCore, ThemedToken } from 'shiki';
import { bundledLanguages, createHighlighter } from 'shiki';
import type { Hunk } from './types';

const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  mjs: 'javascript',
  cjs: 'javascript',
  rb: 'ruby',
  erb: 'erb',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  fish: 'fish',
  sql: 'sql',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  json: 'json',
  jsonc: 'jsonc',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  vue: 'vue',
  svelte: 'svelte',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'proto',
  tf: 'hcl',
  hcl: 'hcl',
  dockerfile: 'docker',
  lua: 'lua',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  scala: 'scala',
  clj: 'clojure',
  r: 'r',
  pl: 'perl',
  ps1: 'powershell',
  ini: 'ini',
  conf: 'ini',
  makefile: 'make',
  mk: 'make',
};

const BASENAME_TO_LANG: Record<string, string> = {
  dockerfile: 'docker',
  makefile: 'make',
  gemfile: 'ruby',
  rakefile: 'ruby',
  'gemfile.lock': 'plaintext',
};

const SHEBANG_TO_LANG: Record<string, string> = {
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  dash: 'shellscript',
  ksh: 'shellscript',
  ash: 'shellscript',
  fish: 'fish',
  node: 'javascript',
  nodejs: 'javascript',
  bun: 'javascript',
  deno: 'typescript',
  tsx: 'typescript',
  'ts-node': 'typescript',
  python: 'python',
  ruby: 'ruby',
  perl: 'perl',
  php: 'php',
  lua: 'lua',
  rscript: 'r',
  elixir: 'elixir',
  escript: 'erlang',
  groovy: 'groovy',
  pwsh: 'powershell',
  expect: 'tcl',
  tclsh: 'tcl',
};

/** Language from a shebang line (`#!/bin/sh`, `#!/usr/bin/env -S node --flags`), or null. */
export function langForShebang(firstLine: string): string | null {
  const m = /^#!(.*)/.exec(firstLine);
  if (!m) return null;
  const tokens = m[1].trim().split(/\s+/);
  let interp = tokens[0]?.split('/').pop() ?? '';
  if (interp === 'env') {
    interp = tokens.slice(1).find((t) => !t.startsWith('-'))?.split('/').pop() ?? '';
  }
  const name = interp.toLowerCase().replace(/\d+(\.\d+)*$/, '');
  return SHEBANG_TO_LANG[name] ?? null;
}

export function langForPath(path: string, firstLine?: string | null): string {
  const basename = path.split('/').pop()?.toLowerCase() ?? '';
  if (BASENAME_TO_LANG[basename]) return BASENAME_TO_LANG[basename];
  const ext = basename.includes('.') ? basename.split('.').pop()! : '';
  if (EXT_TO_LANG[ext]) return EXT_TO_LANG[ext];
  if (firstLine) {
    const shebangLang = langForShebang(firstLine);
    if (shebangLang) return shebangLang;
  }
  return 'plaintext';
}

export const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>(['plaintext']);

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighter({
    themes: [THEMES.light, THEMES.dark],
    langs: [],
  });
  return highlighterPromise;
}

export async function ensureLang(lang: string): Promise<string> {
  if (loadedLangs.has(lang)) return lang;
  if (!(lang in bundledLanguages)) return 'plaintext';
  const highlighter = await getHighlighter();
  await highlighter.loadLanguage(bundledLanguages[lang as keyof typeof bundledLanguages]);
  loadedLangs.add(lang);
  return lang;
}

export interface HighlightedHunk {
  /** token lines for old-side text (context + del lines, in order) */
  old: ThemedToken[][];
  /** token lines for new-side text (context + add lines, in order) */
  new: ThemedToken[][];
}

/**
 * Tokenize a hunk's old-side and new-side text. Each diff line maps to an
 * index in one of these arrays: count context+del lines before it (old side)
 * or context+add lines before it (new side).
 */
export async function highlightHunks(hunks: Hunk[], lang: string, dark: boolean): Promise<HighlightedHunk[]> {
  const highlighter = await getHighlighter();
  const usableLang = await ensureLang(lang);
  const theme = dark ? THEMES.dark : THEMES.light;

  const tokenize = (text: string): ThemedToken[][] =>
    highlighter.codeToTokensBase(text, { lang: usableLang as never, theme });

  return hunks.map((hunk) => {
    const oldText = hunk.lines.filter((l) => l.kind !== 'add').map((l) => l.text).join('\n');
    const newText = hunk.lines.filter((l) => l.kind !== 'del').map((l) => l.text).join('\n');
    return { old: tokenize(oldText), new: tokenize(newText) };
  });
}
