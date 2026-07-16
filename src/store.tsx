import { createContext, useContext } from 'react';
import type { ReviewComment, Selection, Side } from './types';

export type ViewMode = 'unified' | 'split';

/** An open comment editor: a new draft anchored to a selection, or editing an existing comment. */
export interface Draft {
  file: string;
  side: Side;
  startLine: number;
  endLine: number;
  initialBody: string;
  editingId: string | null;
}

export interface ReviewStore {
  comments: ReviewComment[];
  addComment: (c: Omit<ReviewComment, 'id'>) => void;
  updateComment: (id: string, body: string) => void;
  deleteComment: (id: string) => void;

  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  dragging: boolean;
  setDragging: (d: boolean) => void;

  draft: Draft | null;
  setDraft: (d: Draft | null) => void;

  viewMode: ViewMode;
  dark: boolean;
}

const ReviewContext = createContext<ReviewStore | null>(null);
export const ReviewProvider = ReviewContext.Provider;

export function useReview(): ReviewStore {
  const store = useContext(ReviewContext);
  if (!store) throw new Error('useReview outside provider');
  return store;
}

export function selectionRange(s: Selection): { start: number; end: number } {
  return { start: Math.min(s.anchor, s.head), end: Math.max(s.anchor, s.head) };
}

export function lineInSelection(s: Selection | null, file: string, side: Side, line: number | null): boolean {
  if (!s || line === null || s.file !== file || s.side !== side) return false;
  const { start, end } = selectionRange(s);
  return line >= start && line <= end;
}
