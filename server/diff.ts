export type LineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: LineKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export function parseUnifiedDiff(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const rawLines = diff.split('\n');
  // A trailing newline produces a final empty string, which is not a diff line
  if (rawLines[rawLines.length - 1] === '') rawLines.pop();

  for (const line of rawLines) {
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      current = {
        header: line,
        oldStart: oldLine,
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: newLine,
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+')) {
      current.lines.push({ kind: 'add', oldLine: null, newLine: newLine++, text: line.slice(1) });
    } else if (line.startsWith('-')) {
      current.lines.push({ kind: 'del', oldLine: oldLine++, newLine: null, text: line.slice(1) });
    } else if (line.startsWith(' ') || line === '') {
      current.lines.push({ kind: 'context', oldLine: oldLine++, newLine: newLine++, text: line.slice(1) });
    }
    // "\ No newline at end of file" and anything else is ignored
  }
  return hunks;
}
