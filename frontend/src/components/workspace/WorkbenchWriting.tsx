"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";
import { useOptionalProactiveSimOptsRef } from "@/contexts/ProactiveSimContext";
import { fetchWriting, saveWriting } from "@/lib/writingApi";
import type { WritingElement } from "@/lib/elementTypes";

/** Canonical WritingElement re-exported under the render-side name. */
export type WritingElementDef = WritingElement;

/** Idle delay before an autosave PUT + a tutor push. Long enough that typing a
 *  sentence is one save, short enough that a closed tab loses at most a phrase. */
export const WRITING_SAVE_DEBOUNCE_MS = 2000;

/** The "delt med vejlederen" card is coalesced to one per writing BURST. Longer
 *  than the table's 1200ms because a writing burst is a paragraph, not a tabbed
 *  cell — a card per sentence would be the chat spam the debounce exists to
 *  prevent. The push still rides the same 2s save. */
export const WRITING_CARD_DEBOUNCE_MS = 3000;

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

/** What the tutor receives (mcp_app_context.writing.state).
 *
 *  Calculator-shaped: EVERY writing element in one array, matched by id — NOT
 *  table-shaped (one snapshot key shared by all tables), which is the defect
 *  1.1.71 exists to fix and would report a second surface as EMPTY whenever the
 *  student is working in the first. The backend reader (`_read_writing` in
 *  `adk/element_state.py`) matches this shape. */
interface WritingSnapshot {
  docs: {
    id: string;
    title: string;
    text: string;
    words: number;
    chars: number;
    truncated: boolean;
  }[];
}

type SaveState = "idle" | "saving" | "saved" | "error";

/** Marks "this element's last save did not land", so the no-op check on the
 *  next commit cannot match and the text is retried. A NUL byte is not
 *  reachable from a keyboard, so it can never collide with real student text —
 *  which matters, because deleting the key instead would make an empty document
 *  compare equal and silently skip the retry. */
const SAVE_FAILED = "\u0000";

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

interface WorkbenchWritingProps {
  skillId: string;
  /** Keys the per-group store. Falls back to skillId, like the checklist. */
  activityId?: string;
  /** Active chat session; when set, the text is pushed to the tutor so it can
   *  comment without the student pasting anything into the chat. */
  sessionId?: string | null;
  writing: WritingElementDef[];
}

/**
 * WorkbenchWriting — the student's own writing surface (1.1.73).
 *
 * JB, 2026-08-11: *"A text field that the students can edit and then download…
 * Crucially, the tutor should be able to see and comment on what they're
 * writing."*
 *
 * A `<textarea>`, deliberately. 1.1.48 removed a TipTap rich-text editor from
 * the SOLUTION element, and every objection it recorded was about asking
 * students to type physics as LaTeX — none was about prose. So this is the
 * plainest thing that does the job: no editor framework, no maths input, no new
 * dependency. A formula button here would re-create the surface 1.1.48 deleted.
 *
 * The text is per-GROUP state in Firestore (`writing_progress`), not
 * sessionStorage: 1.1.53's premise is one group across separate devices, and
 * `checklist_progress` already records what browser-scoped student state costs.
 * sessionStorage survives here only as an offline buffer.
 *
 * Sharing with the tutor is the usual two wirings — the push (data → AI, on the
 * autosave debounce) and the visible trust card (confirmation → student, one
 * per writing burst). Reading is continuous; COMMENTING is on request, via the
 * feedback button, so the tutor does not interrupt a half-written sentence.
 */
export function WorkbenchWriting({ skillId, activityId, sessionId = null, writing }: WorkbenchWritingProps) {
  const storeId = activityId ?? skillId;
  const storageKey = writingStorageKey(storeId);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [loaded, setLoaded] = useState(false);
  const savedRef = useRef<Record<string, string>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pushWriting = useSimSnapshotPush<WritingSnapshot>(sessionId, "writing");
  const humanToolEvents = useHumanToolEvents();
  const proactiveRef = useOptionalProactiveSimOptsRef();
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCard = useRef<{ req: Promise<Response>; words: number } | null>(null);
  // Latest values, for callbacks that must not re-create on every keystroke.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // --- load: the store first, the offline buffer only as a fallback ---------
  useEffect(() => {
    let cancelled = false;
    const buffered = (() => {
      if (typeof window === "undefined") return {};
      try {
        return JSON.parse(window.sessionStorage.getItem(storageKey) || "{}") as Record<string, string>;
      } catch {
        return {};
      }
    })();

    void fetchWriting(storeId).then((docs) => {
      if (cancelled) return;
      const fromStore: Record<string, string> = {};
      for (const [id, doc] of Object.entries(docs)) fromStore[id] = doc?.text ?? "";
      // A buffered edit is newer than the store by construction — it only exists
      // because its save did not land.
      const merged = { ...fromStore, ...buffered };
      savedRef.current = { ...fromStore };
      setValues(merged);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [storeId, storageKey]);

  const buildSnapshot = useCallback(
    (vals: Record<string, string>): WritingSnapshot => ({
      docs: writing.map((w) => {
        const full = vals[w.id] ?? "";
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
    }),
    [writing],
  );

  const flushCard = useCallback(() => {
    const pending = pendingCard.current;
    pendingCard.current = null;
    cardTimer.current = null;
    if (!pending || pending.words === 0) return; // nothing written → no card
    humanToolEvents.dispatch({
      label: `Din tekst delt med vejlederen (${pending.words} ord)`,
      push: () => pending.req,
    });
  }, [humanToolEvents]);

  /** Persist + share one element's text. Called on the idle debounce and on blur. */
  const commit = useCallback(
    (elementId: string) => {
      const text = valuesRef.current[elementId] ?? "";
      if ((savedRef.current[elementId] ?? "") === text) return; // no-op
      savedRef.current[elementId] = text;

      setSaveState((s) => ({ ...s, [elementId]: "saving" }));
      void saveWriting(storeId, elementId, text)
        .then(() => {
          setSaveState((s) => ({ ...s, [elementId]: "saved" }));
          // The buffer's job is done once the store has it.
          if (typeof window !== "undefined") {
            try {
              const buf = JSON.parse(window.sessionStorage.getItem(storageKey) || "{}");
              delete buf[elementId];
              window.sessionStorage.setItem(storageKey, JSON.stringify(buf));
            } catch {
              /* buffer is best-effort */
            }
          }
        })
        .catch(() => {
          // Never a silent loss: keep the text in the buffer, say "ikke gemt",
          // and let the next commit retry (savedRef is rolled back so it will).
          savedRef.current[elementId] = " unsaved";
          setSaveState((s) => ({ ...s, [elementId]: "error" }));
        });

      const snap = buildSnapshot(valuesRef.current);
      const req = pushWriting(snap, "writing.commit");
      if (!req) return; // no session yet — the .sync catch-up re-pushes
      void req.catch(() => {});
      // ONE card per writing burst; the push itself already fired.
      pendingCard.current = { req, words: countWords(text) };
      if (cardTimer.current) clearTimeout(cardTimer.current);
      cardTimer.current = setTimeout(flushCard, WRITING_CARD_DEBOUNCE_MS);
    },
    [buildSnapshot, flushCard, pushWriting, storageKey, storeId],
  );

  const onChange = (elementId: string, text: string) => {
    setValues((prev) => {
      const next = { ...prev, [elementId]: text };
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* quota / private mode — the store is still the real save */
        }
      }
      return next;
    });
    setSaveState((s) => ({ ...s, [elementId]: "idle" }));
    if (saveTimers.current[elementId]) clearTimeout(saveTimers.current[elementId]);
    saveTimers.current[elementId] = setTimeout(() => commit(elementId), WRITING_SAVE_DEBOUNCE_MS);
  };

  // Clear pending timers on unmount (no dispatch or save after teardown).
  useEffect(
    () => () => {
      if (cardTimer.current) clearTimeout(cardTimer.current);
      for (const t of Object.values(saveTimers.current)) clearTimeout(t);
    },
    [],
  );

  // Catch-up push when the session arrives: students write before the first
  // chat turn (sessionId null → the push short-circuits), and a student
  // returning to a saved draft has a NEW session with nothing pushed at all.
  // Silent — no card for a sync the student did not just perform.
  useEffect(() => {
    if (!sessionId || !loaded) return;
    const snap = buildSnapshot(valuesRef.current);
    if (snap.docs.some((d) => d.words > 0)) {
      const req = pushWriting(snap, "writing.sync");
      if (req) void req.catch(() => {});
    }
    // Only on session arrival / initial load — edits push themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, loaded]);

  /** Ask the tutor to comment — a real chat turn carrying the FULL text.
   *  No trust card: the turn IS the confirmation (the SolutionElementMount
   *  rule). Reading is continuous; commenting is on request, so the tutor does
   *  not interrupt a half-written sentence. */
  const askForFeedback = (w: WritingElementDef) => {
    const text = (values[w.id] ?? "").trim();
    if (!text) return;
    const label = w.title?.trim() || "min tekst";
    proactiveRef?.current?.onProactiveTrigger(
      `Kan du give mig feedback på ${label}? Her er hvad jeg har skrevet:\n\n${text}`,
    );
  };

  return (
    <div className="space-y-4 p-4">
      {writing.map((w) => {
        const text = values[w.id] ?? "";
        const words = countWords(text);
        const maxChars = w.maxChars ?? 20000;
        const target = w.minWords ?? 0;
        const state = saveState[w.id] ?? "idle";
        const nearLimit = text.length > maxChars * 0.9;
        return (
          <section
            key={w.id}
            className="rounded-lg border border-border bg-card p-4 text-sm"
            // Deliberately NO accessible name on the wrapper: the textarea
            // carries it. Naming both would announce two things called
            // "Konklusion" in the same region, which is noise for a screen
            // reader and ambiguous for anything querying by label.
          >
            {w.title && (
              <h3
                id={`writing-${w.id}-title`}
                className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {w.title}
              </h3>
            )}
            {w.prompt && <p className="mb-2 text-sm text-foreground">{w.prompt}</p>}

            <textarea
              aria-label={w.title || "Skrivefelt"}
              value={text}
              maxLength={maxChars}
              placeholder={w.placeholder || "Skriv her…"}
              onChange={(e) => onChange(w.id, e.target.value)}
              onBlur={() => commit(w.id)}
              rows={10}
              className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm leading-relaxed focus:border-primary focus:outline-none"
            />

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {words} ord
                {target > 0 ? ` af ${target}` : ""}
                {nearLimit ? ` · ${text.length} / ${maxChars} tegn` : ""}
                <span className="ml-2" aria-live="polite">
                  {state === "saving" ? "Gemmer…" : null}
                  {state === "saved" ? "Gemt" : null}
                  {state === "error" ? "Ikke gemt — prøver igen" : null}
                </span>
              </span>
              <button
                type="button"
                onClick={() => askForFeedback(w)}
                disabled={words === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
              >
                <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" /> Bed om feedback
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
