"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, MessageSquareText } from "lucide-react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";
import { useOptionalProactiveSimOptsRef } from "@/contexts/ProactiveSimContext";
import { useT } from "@/i18n";
import { readStoredGroupSession } from "@/lib/anonymousGroupAuth";
import { exportWriting, type ExportFormat } from "@/lib/exportDocument";
import { fetchWriting, saveWriting } from "@/lib/writingApi";
import { insertAtCaret, restoreCaret } from "@/lib/insertAtCaret";
import { SymbolStrip, SymbolStripToggle, useSymbolStrip } from "@/components/chat/SymbolStrip";
import type { WritingElement } from "@/lib/elementTypes";
import { appendTutorNotes, formatNotesTimestamp, notesToPlainText } from "@/lib/tutorNotes";
import {
  WRITING_DEFAULT_MAX_CHARS,
  buildWritingSnapshot,
  countWords,
  writingStorageKey,
  type WritingSnapshot,
} from "@/lib/writingSnapshot";
import { useRegisterNotesHandler, type SaveNotesOutcome } from "./tutorNotes";

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

// The push shape + helpers live in lib/writingSnapshot.ts so "Gem som noter"
// (1.1.151 F6) builds the identical snapshot when this element is not mounted.
export { WRITING_PUSH_CHAR_CAP, clipForPush, countWords, writingStorageKey } from "@/lib/writingSnapshot";

type SaveState = "idle" | "saving" | "saved" | "error";

/** Marks "this element's last save did not land", so the no-op check on the
 *  next commit cannot match and the text is retried. A NUL byte is not
 *  reachable from a keyboard, so it can never collide with real student text —
 *  which matters, because deleting the key instead would make an empty document
 *  compare equal and silently skip the retry. */
const SAVE_FAILED = "\u0000";

interface WorkbenchWritingProps {
  skillId: string;
  /** Keys the per-group store. Falls back to skillId, like the checklist. */
  activityId?: string;
  /** Active chat session; when set, the text is pushed to the tutor so it can
   *  comment without the student pasting anything into the chat. */
  sessionId?: string | null;
  /** Shown in the exported file's provenance header, so a downloaded document
   *  says which lesson it came from. Falls back to the element's own title. */
  activityTitle?: string;
  writing: WritingElementDef[];
}

/** Offered download formats. `.docx` is deliberately absent — see the header of
 *  `lib/exportDocument.ts` and human gate 1 in the design doc. */
const EXPORT_FORMATS: { value: ExportFormat; label: "formatRtf" | "formatTxt" | "formatMd" }[] = [
  { value: "rtf", label: "formatRtf" },
  { value: "txt", label: "formatTxt" },
  { value: "md", label: "formatMd" },
];

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
 * The 1.1.118 symbol strip is not that: it inserts Unicode characters (Δ, ρ,
 * ²) into the plain textarea — what the student typed stays a string.
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
export function WorkbenchWriting({
  skillId,
  activityId,
  sessionId = null,
  activityTitle,
  writing,
}: WorkbenchWritingProps) {
  const t = useT("WorkbenchWriting");
  const storeId = activityId ?? skillId;
  const storageKey = writingStorageKey(storeId);
  const [values, setValues] = useState<Record<string, string>>({});
  // 1.1.118 — one strip state for the whole element; a ref per textarea so a
  // chip inserts at that section's caret. No wink here: the chat introduced it.
  const symbolStrip = useSymbolStrip();
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
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
    (vals: Record<string, string>): WritingSnapshot => buildWritingSnapshot(writing, vals),
    [writing],
  );

  const flushCard = useCallback(() => {
    const pending = pendingCard.current;
    pendingCard.current = null;
    cardTimer.current = null;
    if (!pending || pending.words === 0) return; // nothing written → no card
    humanToolEvents.dispatch({
      label: t("sharedCard", { count: pending.words }),
      push: () => pending.req,
    });
  }, [humanToolEvents, t]);

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
      // 1.1.136 M0 — the card's own text as a log label (not a card label: one
      // card per writing burst, so a label per autosave would restore many).
      const req = pushWriting(snap, "writing.commit", null, {
        logLabel: t("sharedCard", { count: countWords(text) }),
        activityId: storeId,
      });
      if (!req) return; // no session yet — the .sync catch-up re-pushes
      void req.catch(() => {});
      // ONE card per writing burst; the push itself already fired.
      pendingCard.current = { req, words: countWords(text) };
      if (cardTimer.current) clearTimeout(cardTimer.current);
      cardTimer.current = setTimeout(flushCard, WRITING_CARD_DEBOUNCE_MS);
    },
    [buildSnapshot, flushCard, pushWriting, storageKey, storeId, t],
  );

  /** 1.1.151 F6 — "Gem som noter": the STUDENT pressed it on a tutor reply.
   *  Appends (never replaces) under a heading to the first writing surface,
   *  then shares it like any deliberate edit: the push AND one trust card for
   *  this one-shot action. Registered on the chat page's bridge while this
   *  element is mounted and loaded, because only this component knows about an
   *  edit still sitting in its autosave debounce. */
  const saveNotes = useCallback(
    async (markdown: string): Promise<SaveNotesOutcome> => {
      const target = writing[0];
      const title = target.title?.trim() || t("untitled");
      const notes = notesToPlainText(markdown);
      const heading = t("notesHeading", { date: formatNotesTimestamp(new Date()) });
      const next = appendTutorNotes(valuesRef.current[target.id] ?? "", heading, notes);
      if (next.length > (target.maxChars ?? WRITING_DEFAULT_MAX_CHARS)) return { kind: "full", title };

      // The append carries any pending edit of this element with it, so that
      // autosave is superseded rather than raced.
      if (saveTimers.current[target.id]) clearTimeout(saveTimers.current[target.id]);
      const nextValues = { ...valuesRef.current, [target.id]: next };
      valuesRef.current = nextValues;
      setValues(nextValues);
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(storageKey, JSON.stringify(nextValues));
        } catch {
          /* quota / private mode — the store is still the real save */
        }
      }
      savedRef.current[target.id] = next;
      setSaveState((s) => ({ ...s, [target.id]: "saving" }));

      const label = t("notesSavedCard", { title, count: countWords(notes) });
      const req = pushWriting(buildSnapshot(nextValues), "writing.commit", label, {
        logLabel: label,
        activityId: storeId,
      });
      if (req) {
        void req.catch(() => {});
        humanToolEvents.dispatch({ label, push: () => req });
      }

      try {
        await saveWriting(storeId, target.id, next);
        setSaveState((s) => ({ ...s, [target.id]: "saved" }));
        if (typeof window !== "undefined") {
          try {
            const buf = JSON.parse(window.sessionStorage.getItem(storageKey) || "{}");
            delete buf[target.id];
            window.sessionStorage.setItem(storageKey, JSON.stringify(buf));
          } catch {
            /* buffer is best-effort */
          }
        }
        return { kind: "saved", title };
      } catch {
        savedRef.current[target.id] = SAVE_FAILED;
        setSaveState((s) => ({ ...s, [target.id]: "error" }));
        return { kind: "unsaved", title };
      }
    },
    [buildSnapshot, humanToolEvents, pushWriting, storageKey, storeId, t, writing],
  );
  useRegisterNotesHandler(loaded && writing.length > 0 ? saveNotes : null);

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

  const insertSymbol = (elementId: string, glyph: string) => {
    const el = textareaRefs.current[elementId] ?? null;
    const r = insertAtCaret(values[elementId] ?? "", glyph, el?.selectionStart, el?.selectionEnd);
    onChange(elementId, r.value);
    restoreCaret(el, r.caret);
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
      const words = snap.docs.reduce((n, d) => n + d.words, 0);
      const req = pushWriting(snap, "writing.sync", null, {
        logLabel: t("sharedCard", { count: words }),
        activityId: storeId,
      });
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
    const label = w.title?.trim() || t("feedbackFallbackTitle");
    proactiveRef?.current?.onProactiveTrigger(t("feedbackRequest", { title: label, text }));
  };

  /** Download the text as a file the student keeps. Entirely client-side — the
   *  words are already here, so there is no round-trip and no second copy of
   *  the student's work stored anywhere. */
  const download = (w: WritingElementDef, format: ExportFormat) => {
    const text = values[w.id] ?? "";
    if (!text.trim()) return;
    exportWriting(
      {
        title: w.title ?? "",
        activityTitle: activityTitle ?? w.title ?? "",
        groupCode: readStoredGroupSession()?.group_code ?? "",
        text,
        date: new Date().toISOString().slice(0, 10),
      },
      format,
    );
  };

  return (
    <div className="space-y-4 p-4">
      {writing.map((w) => {
        const text = values[w.id] ?? "";
        const words = countWords(text);
        const maxChars = w.maxChars ?? WRITING_DEFAULT_MAX_CHARS;
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

            <SymbolStrip
              id={`writing-${w.id}-symbols`}
              open={symbolStrip.open}
              onInsert={(glyph) => insertSymbol(w.id, glyph)}
            />
            <textarea
              ref={(el) => {
                textareaRefs.current[w.id] = el;
              }}
              aria-label={w.title || t("untitled")}
              value={text}
              maxLength={maxChars}
              placeholder={w.placeholder || t("placeholder")}
              onChange={(e) => onChange(w.id, e.target.value)}
              onBlur={() => commit(w.id)}
              rows={10}
              className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm leading-relaxed focus:border-primary focus:outline-none"
            />

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {t("wordCount", { count: words })}
                {target > 0 ? t("wordTarget", { target }) : ""}
                {nearLimit ? t("charCount", { length: String(text.length), max: String(maxChars) }) : ""}
                <span className="ml-2" aria-live="polite">
                  {state === "saving" ? t("saving") : null}
                  {state === "saved" ? t("saved") : null}
                  {state === "error" ? t("saveError") : null}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <SymbolStripToggle
                  controlsId={`writing-${w.id}-symbols`}
                  open={symbolStrip.open}
                  onToggle={symbolStrip.toggle}
                />
                {/* A select, not three buttons: downloading is a secondary
                    action and three of them is clutter in a ~700px pane. */}
                <label className="inline-flex items-center gap-1.5">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">{t("downloadLabel", { title: w.title || t("downloadFallbackTitle") })}</span>
                  <select
                    aria-label={t("downloadLabel", { title: w.title || t("downloadFallbackTitle") })}
                    value=""
                    disabled={words === 0}
                    onChange={(e) => {
                      const format = e.target.value as ExportFormat;
                      if (format) download(w, format);
                      e.target.value = "";
                    }}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
                  >
                    <option value="">{t("downloadAs")}</option>
                    {EXPORT_FORMATS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {t(f.label)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => askForFeedback(w)}
                  disabled={words === 0}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" /> {t("askFeedback")}
                </button>
              </span>
            </div>
          </section>
        );
      })}
    </div>
  );
}
