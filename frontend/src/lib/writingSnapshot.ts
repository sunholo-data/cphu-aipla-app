/**
 * The writing element's tutor push, as pure functions (1.1.73).
 *
 * Lives outside `WorkbenchWriting.tsx` so the one other writer of the writing
 * surface — "Gem som noter" (1.1.151 F6), which can save while the element is
 * not mounted (a sim has taken over the workspace, or the Documents tab is in
 * front) — builds the exact same snapshot. Two shapes for one channel would
 * let one writer report the other's surface as EMPTY.
 */

import type { WritingElement } from "@/lib/elementTypes";

/** How much of the text rides in the per-turn tutor context.
 *
 *  This is load-bearing for cost (Axiom 4): `mcp_app_context.writing.state` is
 *  injected into EVERY agent prompt for the rest of the session, so an uncapped
 *  20,000-char essay would be ~5k tokens on every single turn. The tail is kept
 *  (what the student is working on now) plus the opening for orientation, and
 *  `truncated` tells the tutor so it says so rather than commenting confidently
 *  on half a text. "Bed om feedback" sends the WHOLE text as one turn. */
export const WRITING_PUSH_CHAR_CAP = 4000;

/** Chars of the opening kept when truncating, so the tutor knows what the piece
 *  set out to be and not only where it currently is. */
const WRITING_PUSH_HEAD_CHARS = 600;

/** Default `maxChars` of a writing element when the teacher set none. */
export const WRITING_DEFAULT_MAX_CHARS = 20000;

/** What the tutor receives (mcp_app_context.writing.state).
 *
 *  Calculator-shaped: EVERY writing element in one array, matched by id — NOT
 *  table-shaped (one snapshot key shared by all tables), which is the defect
 *  1.1.71 exists to fix and would report a second surface as EMPTY whenever the
 *  student is working in the first. The backend reader (`_read_writing` in
 *  `adk/element_state.py`) matches this shape. */
export interface WritingSnapshot {
  docs: {
    id: string;
    title: string;
    text: string;
    words: number;
    chars: number;
    truncated: boolean;
  }[];
}

/** sessionStorage key holding an activity's writing, as an offline buffer. The
 *  store is authoritative — this only exists so a save that fails while the
 *  student is on a school wifi dead spot is not lost work. */
export function writingStorageKey(activityId: string): string {
  return `aipla.writing:${activityId}`;
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Cap the text for the per-turn push: keep the opening + the tail, mark it. */
export function clipForPush(text: string): { text: string; truncated: boolean } {
  if (text.length <= WRITING_PUSH_CHAR_CAP) return { text, truncated: false };
  const head = text.slice(0, WRITING_PUSH_HEAD_CHARS);
  const tail = text.slice(-(WRITING_PUSH_CHAR_CAP - WRITING_PUSH_HEAD_CHARS));
  return { text: `${head}\n\n[…]\n\n${tail}`, truncated: true };
}

/** Every writing element's current text, in the shape the tutor reads. */
export function buildWritingSnapshot(writing: WritingElement[], values: Record<string, string>): WritingSnapshot {
  return {
    docs: writing.map((w) => {
      const full = values[w.id] ?? "";
      const clipped = clipForPush(full);
      return {
        id: w.id,
        title: w.title ?? "",
        text: clipped.text,
        words: countWords(full),
        chars: full.length,
        truncated: clipped.truncated,
      };
    }),
  };
}
