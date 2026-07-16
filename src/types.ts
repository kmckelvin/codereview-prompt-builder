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

export type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: FileStatus;
  hunks: Hunk[];
}

export interface MRInfo {
  title: string;
  author: string;
  webUrl: string | null;
  sourceBranch: string;
  targetBranch: string;
  state: string;
  headSha: string | null;
  promptHeader: string;
}

export interface MRData {
  info: MRInfo;
  files: DiffFile[];
}

export type Side = 'old' | 'new';

export interface ReviewComment {
  id: string;
  file: string;
  side: Side;
  startLine: number;
  endLine: number;
  body: string;
}

export interface Selection {
  file: string;
  side: Side;
  anchor: number;
  head: number;
}
