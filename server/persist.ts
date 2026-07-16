import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, normalize } from 'node:path';

/** stateKey is a relative path (e.g. "gitlab.com/group/repo/123.json") under the state root. */
function stateFile(stateKey: string): string {
  const file = normalize(join(homedir(), '.codereview-commenter', stateKey));
  if (!file.startsWith(join(homedir(), '.codereview-commenter'))) {
    throw new Error(`State key escapes the state directory: ${stateKey}`);
  }
  return file;
}

export async function loadState(stateKey: string): Promise<string> {
  try {
    return await readFile(stateFile(stateKey), 'utf8');
  } catch {
    return '{"comments":[]}';
  }
}

export async function saveState(stateKey: string, body: string): Promise<void> {
  const file = stateFile(stateKey);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body, 'utf8');
}
