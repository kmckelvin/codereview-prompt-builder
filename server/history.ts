import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const HISTORY_FILE = join(homedir(), '.codereview-commenter', 'history.json');
const MAX_ENTRIES = 15;

export interface HistoryEntry {
  target: unknown;
  title: string;
  subtitle: string;
  openedAt: number;
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(HISTORY_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function recordHistory(entry: HistoryEntry): Promise<void> {
  const key = JSON.stringify(entry.target);
  const rest = (await loadHistory()).filter((e) => JSON.stringify(e.target) !== key);
  const history = [entry, ...rest].slice(0, MAX_ENTRIES);
  await mkdir(dirname(HISTORY_FILE), { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}
