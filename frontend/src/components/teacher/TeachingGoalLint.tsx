"use client";

import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Check } from "lucide-react";
import { useEffect } from "react";

import type { ActivityBuilder } from "@/hooks/useActivityBuilder";
import { useT } from "@/i18n";
import { moveBackToGoal, moveToNotes, visibleSpans } from "@/lib/teachingGoalLint";

/**
 * 1.1.141 M2 — the non-blocking warning beside the teaching goal.
 *
 * "These lines tell the tutor how to teach. Mikkel teaches with ESRU, which
 * will take precedence: [line]" — with **Move to tutor notes** and **Keep**.
 * Shows only lines still present in the current goal, so editing a line away
 * clears its warning without another lint.
 *
 * M3 — when the lint ran on a co-pilot draft (`mode: "move"`), the detected
 * lines are moved into tutor notes once, automatically, and the teacher is told
 * what moved, with Undo. Nothing is ever deleted: the lines are in the visible
 * tutor-notes field below, and one click puts them back.
 */
export function TeachingGoalLint({ builder }: { builder: ActivityBuilder }) {
  const t = useT("TeachingGoalLint");
  const b = builder;
  const lint = b.goalLint;

  // M3 — the co-pilot's draft: move once, while the goal is still that draft.
  useEffect(() => {
    if (!lint || lint.mode !== "move") return;
    if (lint.text !== b.teachingGoal.trim() || lint.result.spans.length === 0) {
      b.setGoalLint({ ...lint, mode: "warn" });
      return;
    }
    const out = moveToNotes(b.teachingGoal, b.tutorNotes, lint.result.spans.map((s) => s.text));
    // Never leave an activity with no goal: a draft made entirely of
    // how-to-teach lines stays as it is, with the warning.
    if (!out.goal.trim() || out.moved.length === 0) {
      b.setGoalLint({ ...lint, mode: "warn" });
      return;
    }
    b.setTeachingGoal(out.goal);
    b.setTutorNotes(out.notes);
    b.setGoalLint({ ...lint, mode: "warn", moved: out.moved });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lint]);

  if (!lint) return null;
  const spans = visibleSpans(lint, b.teachingGoal);
  const { tutorName, frameworkLabel, constructNames } = lint.result;

  const keep = (text: string) => b.setGoalLint({ ...lint, kept: [...lint.kept, text] });
  const move = (text: string) => {
    const out = moveToNotes(b.teachingGoal, b.tutorNotes, [text]);
    b.setTeachingGoal(out.goal);
    b.setTutorNotes(out.notes);
  };
  const undo = () => {
    const out = moveBackToGoal(b.teachingGoal, b.tutorNotes, lint.moved);
    b.setTeachingGoal(out.goal);
    b.setTutorNotes(out.notes);
    b.setGoalLint({ ...lint, moved: [] });
  };

  return (
    <div className="flex flex-col gap-2">
      {lint.moved.length > 0 ? (
        <p
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
        >
          <ArrowDownToLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{t("moved", { count: lint.moved.length })}</span>
          <button type="button" onClick={undo} className="rounded border border-sky-300 px-2 py-0.5 font-medium hover:bg-sky-100 dark:hover:bg-sky-900">
            {t("undo")}
          </button>
        </p>
      ) : null}
      {spans.length > 0 ? (
        <div
          role="note"
          aria-label={t("aria")}
          className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          <p className="flex items-start gap-1.5 font-medium">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {t("intro")}{" "}
              {frameworkLabel
                ? t("precedence", { tutor: tutorName ?? t("theTutor"), approach: frameworkLabel })
                : t("noApproach")}
            </span>
          </p>
          <ul className="flex flex-col gap-2">
            {spans.map((s) => (
              <li key={s.text} className="flex flex-col gap-1 rounded border border-amber-200 bg-white/60 px-2 py-1.5 dark:border-amber-800 dark:bg-black/20">
                <q className="italic">{s.text}</q>
                <span className="text-[11px] text-amber-800 dark:text-amber-300">
                  {t(`kind_${s.kind}`)}
                  {s.conflictsWith.length > 0
                    ? ` · ${t("conflicts", { constructs: s.conflictsWith.map((k) => constructNames[k] ?? k).join(", ") })}`
                    : ""}
                </span>
                <span className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => move(s.text)}
                    className="flex items-center gap-1 rounded border border-amber-400 px-2 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900"
                  >
                    <ArrowDownToLine className="h-3 w-3" aria-hidden="true" /> {t("move")}
                  </button>
                  <button
                    type="button"
                    onClick={() => keep(s.text)}
                    className="flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    <Check className="h-3 w-3" aria-hidden="true" /> {t("keep")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 1.1.141 M3 — the visible tutor-notes field. Rendered only once the activity
 * has notes, so an activity that never had any looks exactly as before.
 */
export function TutorNotesField({ builder }: { builder: ActivityBuilder }) {
  const t = useT("TeachingGoalLint");
  const b = builder;
  if (!b.tutorNotes.trim()) return null;
  const lines = b.tutorNotes.split("\n").map((l) => l.trim()).filter(Boolean);
  const moveAllBack = () => {
    const out = moveBackToGoal(b.teachingGoal, b.tutorNotes, lines);
    b.setTeachingGoal(out.goal);
    b.setTutorNotes(out.notes);
    if (b.goalLint) b.setGoalLint({ ...b.goalLint, moved: [] });
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center justify-between gap-2">
        <label htmlFor="activity-tutor-notes" className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t("notesLabel")}
        </label>
        <button
          type="button"
          onClick={moveAllBack}
          className="flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ArrowUpFromLine className="h-3 w-3" aria-hidden="true" /> {t("moveBack")}
        </button>
      </span>
      <textarea
        id="activity-tutor-notes"
        value={b.tutorNotes}
        onChange={(e) => b.setTutorNotes(e.target.value)}
        rows={3}
        maxLength={2000}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <span className="text-xs text-slate-500">{t("notesHelp")}</span>
    </div>
  );
}
