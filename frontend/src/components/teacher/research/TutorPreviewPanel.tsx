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
import { TutorFace } from "@/components/teacher/research/TutorFace";
import { useT } from "@/i18n";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
// Copy lives in messages/*/teacher-research.json — 1.1.108.

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
  const t = useT("TutorPreviewPanel");
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
        setPicked(cat.tutors.slice(0, MAX_TUTORS).map((tu) => tu.id));
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
    if (picked.length === 0) return setError(t("needTutor"));
    if (!message.trim()) return setError(t("needMessage"));
    setBusy(true);
    setError(null);
    try {
      setReplies(await previewTutors(message.trim(), picked));
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TeacherCard>
      <h2 className="flex items-center gap-2 text-base font-medium">
        <MessagesSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        {t("title")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("blurb")}</p>

      <p className="mt-3 text-xs font-medium">{t("pickPrompt")}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {tutors.map((tu) => {
          const on = picked.includes(tu.id);
          return (
            <button
              key={tu.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(tu.id)}
              className={
                on
                  ? "flex items-center gap-1.5 rounded border border-brand bg-brand/10 py-0.5 pl-0.5 pr-2 text-xs font-medium"
                  : "flex items-center gap-1.5 rounded border border-border py-0.5 pl-0.5 pr-2 text-xs hover:bg-accent"
              }
            >
              <TutorFace avatar={tu.persona?.avatar} name={tu.displayName} size="sm" />
              {tu.displayName}
              <span className="ml-1.5 opacity-70">{tu.frameworkName ?? t("noApproach")}</span>
            </button>
          );
        })}
      </div>

      <label htmlFor="preview-message" className="mt-4 block text-xs font-medium">
        {t("messageLabel")}
      </label>
      <textarea
        id="preview-message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t("placeholder")}
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
        {busy ? t("running") : picked.length > 1 ? t("run") : t("runOne")}
      </button>

      {replies ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">{t("sameBoth")}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {replies.map((r) => (
              <div key={r.tutorId} className="rounded border border-border p-3">
                {/* The reply carries no avatar; the catalogue loaded for the
                    picker does, so the same face heads the column. */}
                <div className="flex items-center gap-2">
                  <TutorFace
                    avatar={tutors.find((tu) => tu.id === r.tutorId)?.persona?.avatar}
                    name={r.displayName ?? r.tutorId}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.displayName ?? r.tutorId}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.composedFrom?.approach ?? t("noApproach")}
                      {r.composedFrom?.register ? ` · ${r.composedFrom.register}` : ""}
                    </p>
                  </div>
                </div>
                {r.ok ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm">{r.reply}</p>
                ) : (
                  <p className="mt-2 text-sm text-destructive">{r.error}</p>
                )}
                {r.composedFrom?.notIncluded?.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground">
                      {t("composedTitle")}
                    </summary>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("notIncluded", { missing: r.composedFrom.notIncluded.join(", ") })}
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
