"use client";

/**
 * "Gem som noter" — save a tutor reply into the student's writing surface
 * (1.1.151 F6, decided by M 2026-10-08).
 *
 * Seminar 2026-10-05: *"kan du opsummere vores snak så jeg kan gemme dem som
 * noter"*. The tutor summarised in the chat and there was nowhere to keep it.
 *
 * The action is the STUDENT's, never the tutor's: a button on a tutor reply,
 * pressed by the student, appends the reply under a heading to their own
 * writing surface (the 1.1.73 element). The tutor still has no write path into
 * the document (Axiom 2, `_describe_writing` in `backend/adk/element_manifest.py`).
 * The student's text is never overwritten — the notes go after it.
 *
 * It reaches the tutor like any other student edit of the writing surface:
 * the `writing` state push AND a "shared with the AI" trust card — one card per
 * save, because it is a one-shot action (the workbench-element-builder table).
 *
 * Two writers, one owner at a time:
 *  - The writing element is MOUNTED → it owns the text (it may be holding an
 *    unsaved edit in its debounce window), so it registers a handler on the
 *    bridge and the save goes through it.
 *  - Not mounted (a sim has taken over the workspace, the Documents tab is in
 *    front) → nothing holds unsaved text in memory, so the save reads the store
 *    (and the offline buffer), appends, and writes back directly. On remount
 *    the element loads the saved text like any other.
 *  - The activity has no writing surface → copy to the clipboard and say so.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";
import { useT } from "@/i18n";
import type { WritingElement } from "@/lib/elementTypes";
import { appendTutorNotes, formatNotesTimestamp, notesToPlainText } from "@/lib/tutorNotes";
import { fetchWriting, saveWriting } from "@/lib/writingApi";
import {
  WRITING_DEFAULT_MAX_CHARS,
  buildWritingSnapshot,
  countWords,
  writingStorageKey,
  type WritingSnapshot,
} from "@/lib/writingSnapshot";

/** What happened, for the button's one-line status. */
export type SaveNotesOutcome =
  /** Appended and stored; the tutor has it. */
  | { kind: "saved"; title: string }
  /** Appended in the writing surface, but the store did not take it yet (the
   *  element retries like any failed autosave). */
  | { kind: "unsaved"; title: string }
  /** It would not fit under the element's character limit — nothing changed. */
  | { kind: "full"; title: string }
  /** No writing surface in this activity: copied to the clipboard instead. */
  | { kind: "copied" }
  /** No writing surface, and the clipboard refused. */
  | { kind: "copyFailed" };

/** A writer that appends a tutor reply (Markdown) to the student's notes. */
export type NotesHandler = (markdown: string) => Promise<SaveNotesOutcome>;

export interface TutorNotesBridge {
  register(handler: NotesHandler): () => void;
  current(): NotesHandler | null;
}

/** The chat page owns one bridge; the mounted writing element registers on it. */
export function createTutorNotesBridge(): TutorNotesBridge {
  let handler: NotesHandler | null = null;
  return {
    register(h) {
      handler = h;
      return () => {
        if (handler === h) handler = null;
      };
    },
    current: () => handler,
  };
}

const BridgeContext = createContext<TutorNotesBridge | null>(null);
export const TutorNotesBridgeProvider = BridgeContext.Provider;

/** Called by the writing element: while mounted (and loaded), saves go through it. */
export function useRegisterNotesHandler(handler: NotesHandler | null): void {
  const bridge = useContext(BridgeContext);
  const ref = useRef(handler);
  ref.current = handler;
  const active = handler !== null;
  useEffect(() => {
    if (!bridge || !active) return;
    return bridge.register((md) => (ref.current ? ref.current(md) : Promise.resolve({ kind: "copyFailed" })));
  }, [bridge, active]);
}

/** The save action a tutor bubble offers. Null outside a student activity
 *  chat (teacher chats, the builder preview) — the button then does not render. */
export interface SaveNotesAction {
  save: NotesHandler;
  /** Where a press lands — decides the button's accessible name up front. */
  target: "writing" | "clipboard";
}
const SaveNotesContext = createContext<SaveNotesAction | null>(null);
export const SaveNotesProvider = SaveNotesContext.Provider;
export function useSaveNotesAction(): SaveNotesAction | null {
  return useContext(SaveNotesContext);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function readBuffer(storageKey: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(storageKey) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeBuffer(storageKey: string, buf: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(buf));
  } catch {
    /* the buffer is best-effort; the store is the real save */
  }
}

/**
 * The chat page's save action. Routes to the mounted writing element when
 * there is one, otherwise appends through the store; copies when the activity
 * has no writing surface (or no activity store to write to).
 */
export function useSaveTutorNotes({
  bridge,
  writing,
  activityId,
  sessionId,
}: {
  bridge: TutorNotesBridge;
  writing: WritingElement[];
  /** The `act-…` id the writing store is keyed by; undefined → copy only. */
  activityId?: string;
  sessionId: string | null;
}): SaveNotesAction {
  const t = useT("WorkbenchWriting");
  const pushWriting = useSimSnapshotPush<WritingSnapshot>(sessionId, "writing");
  const humanToolEvents = useHumanToolEvents();
  const writingRef = useRef(writing);
  writingRef.current = writing;

  const saveDirect = useCallback(
    async (markdown: string, storeId: string): Promise<SaveNotesOutcome> => {
      const defs = writingRef.current;
      const target = defs[0];
      const title = target.title?.trim() || t("untitled");
      const storageKey = writingStorageKey(storeId);
      const stored = await fetchWriting(storeId);
      const values: Record<string, string> = {};
      for (const [id, doc] of Object.entries(stored)) values[id] = doc?.text ?? "";
      // An unsaved buffered edit is newer than the store — append to THAT, or
      // the next load would let the buffer silently drop the notes again.
      const buffer = readBuffer(storageKey);
      Object.assign(values, buffer);
      const heading = t("notesHeading", { date: formatNotesTimestamp(new Date()) });
      const next = appendTutorNotes(values[target.id] ?? "", heading, notesToPlainText(markdown));
      if (next.length > (target.maxChars ?? WRITING_DEFAULT_MAX_CHARS)) return { kind: "full", title };
      values[target.id] = next;

      let outcome: SaveNotesOutcome = { kind: "saved", title };
      try {
        await saveWriting(storeId, target.id, next);
        if (target.id in buffer) {
          delete buffer[target.id];
          writeBuffer(storageKey, buffer);
        }
      } catch {
        // Never a silent loss: park it in the buffer the element loads from.
        writeBuffer(storageKey, { ...buffer, [target.id]: next });
        outcome = { kind: "unsaved", title };
      }

      const label = t("notesSavedCard", { title, count: countWords(notesToPlainText(markdown)) });
      const req = pushWriting(buildWritingSnapshot(defs, values), "writing.commit", label, {
        logLabel: label,
        activityId: storeId,
      });
      if (req) {
        void req.catch(() => {});
        humanToolEvents.dispatch({ label, push: () => req });
      }
      return outcome;
    },
    [humanToolEvents, pushWriting, t],
  );

  const save = useCallback(
    async (markdown: string): Promise<SaveNotesOutcome> => {
      if (writingRef.current.length > 0) {
        const mounted = bridge.current();
        if (mounted) return mounted(markdown);
        if (activityId) return saveDirect(markdown, activityId);
      }
      return (await copyToClipboard(notesToPlainText(markdown))) ? { kind: "copied" } : { kind: "copyFailed" };
    },
    [activityId, bridge, saveDirect],
  );
  const target: SaveNotesAction["target"] = writing.length > 0 ? "writing" : "clipboard";
  return useMemo(() => ({ save, target }), [save, target]);
}
