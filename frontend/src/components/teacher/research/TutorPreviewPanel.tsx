"use client";

import { useEffect, useState } from "react";
import { MessagesSquare, Play } from "lucide-react";

import {
  type TutorPayload,
  type TutorPreviewReply,
  fetchTutorCatalogue,
  previewTutors,
} from "@/lib/teacherApi";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
const copy = {
  title: "Try the tutors, side by side",
  blurb:
    "Ask the same question of two tutors and read what each does with it. This is your own conversation — no student is involved, and nothing here is recorded as teaching.",
  pickPrompt: "Pick up to two tutors",
  messageLabel: "Say something a student might say",
  placeholder: "e.g. A heavy ball and a light ball are dropped together. Which lands first?",
  run: "Ask both",
  runOne: "Ask",
  running: "Asking…",
  needTutor: "Pick at least one tutor.",
  needMessage: "Type something to ask.",
  failed: "Could not reach the tutors. Try again.",
  noApproach: "no teaching approach set",
  composedTitle: "What this tutor was told",
  notIncluded: (missing: string[]) =>
    `A preview does not include ${missing.join(", ")} — a real lesson turn carries those too, so this shows the approach rather than the whole prompt.`,
  sameBoth: "Both tutors were asked the same thing.",
} as const;

const MAX_TUTORS = 2;

/**
 * Tutor preview and comparison (1.1.91 M3).
 *
 * **The comparison is the point.** The design's line is that "the question is
 * nearly always comparative" — one tutor tells you what it said, two tell you
 * what the approach changed. So the panel is built around two columns rather
 * than offering comparison as an extra.
 *
 * Two audiences, one surface: a researcher checking an approach does what it
 * claims before signing it off (all seven are still `ready_for_review`), and a
 * teacher comparing pedagogies by talking to them. The second was asked for on
 * 2026-09-09 — "teachers can use the tutors as teaching training" — and it is
 * the one teacher-facing use of the tutor library available while both legal
 * gates are shut, because it involves no student and no consent question.
 *
 * ⚠️ It shows what each prompt was COMPOSED FROM, including what a preview does
 * not carry. A reviewer who thinks they are reading the full lesson prompt would
 * sign off something they have not seen.
 */
export function TutorPreviewPanel() {
  const [tutors, setTutors] = useState<TutorPayload[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [replies, setReplies] = useState<TutorPreviewReply[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTutorCatalogue()
      .then((cat) => {
        if (cancelled) return;
        setTutors(cat.tutors);
        // Default to the first two, so the comparison is one click from here.
        setPicked(cat.tutors.slice(0, MAX_TUTORS).map((t) => t.id));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string) =>
    setPicked((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_TUTORS ? cur : [...cur, id],
    );

  const run = async () => {
    if (picked.length === 0) return setError(copy.needTutor);
    if (!message.trim()) return setError(copy.needMessage);
    setBusy(true);
    setError(null);
    try {
      setReplies(await previewTutors(message.trim(), picked));
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TeacherCard>
      <h2 className="flex items-center gap-2 text-base font-medium">
        <MessagesSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        {copy.title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{copy.blurb}</p>

      <p className="mt-3 text-xs font-medium">{copy.pickPrompt}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {tutors.map((t) => {
          const on = picked.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(t.id)}
              className={
                on
                  ? "rounded border border-brand bg-brand/10 px-2 py-1 text-xs font-medium"
                  : "rounded border border-border px-2 py-1 text-xs hover:bg-accent"
              }
            >
              {t.displayName}
              <span className="ml-1.5 opacity-70">{t.frameworkName ?? copy.noApproach}</span>
            </button>
          );
        })}
      </div>

      <label htmlFor="preview-message" className="mt-4 block text-xs font-medium">
        {copy.messageLabel}
      </label>
      <textarea
        id="preview-message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={copy.placeholder}
        rows={3}
        className="mt-1 w-full rounded border bg-background p-2 text-sm"
      />

      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="mt-2 flex items-center gap-1.5 rounded bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        <Play className="h-3.5 w-3.5" aria-hidden />
        {busy ? copy.running : picked.length > 1 ? copy.run : copy.runOne}
      </button>

      {replies ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">{copy.sameBoth}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {replies.map((r) => (
              <div key={r.tutorId} className="rounded border border-border p-3">
                <p className="text-sm font-medium">{r.displayName ?? r.tutorId}</p>
                <p className="text-xs text-muted-foreground">
                  {r.composedFrom?.approach ?? copy.noApproach}
                  {r.composedFrom?.register ? ` · ${r.composedFrom.register}` : ""}
                </p>
                {r.ok ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm">{r.reply}</p>
                ) : (
                  <p className="mt-2 text-sm text-destructive">{r.error}</p>
                )}
                {r.composedFrom?.notIncluded?.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground">
                      {copy.composedTitle}
                    </summary>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {copy.notIncluded(r.composedFrom.notIncluded)}
                    </p>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </TeacherCard>
  );
}
