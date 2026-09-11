"use client";

import type { FrameworkRegister } from "@/lib/teacherApi";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
const copy = {
  label: "Voice",
  help: "How this approach is delivered. Optional, and most approaches leave it unset — an approach that says nothing about voice cannot contradict its own moves.",
  none: "Not set",
  noneHelp: "The tutor's own voice, unchanged.",
  concise: "Concise",
  conciseHelp: "One or two sentences, no follow-up question.",
  rigorous: "Rigorous",
  rigorousHelp: "Exam-level expectations; does not lower the bar.",
  warm: "Warm",
  warmHelp: "Encouraging, hints before asking.",
  // ⚠️ The warning that is the whole reason this control moved here.
  clash:
    "This voice tells the tutor not to end with a question, while the moves above are mostly questions. Check the preview below — the voice is appended last, so it has the final word.",
  clashWarm:
    "This voice offers a hint before asking, while the moves above elicit first. Check the preview below — the voice is appended last, so it has the final word.",
} as const;

const OPTIONS: { id: FrameworkRegister | ""; label: string; help: string }[] = [
  { id: "", label: copy.none, help: copy.noneHelp },
  { id: "concise", label: copy.concise, help: copy.conciseHelp },
  { id: "rigorous", label: copy.rigorous, help: copy.rigorousHelp },
  { id: "warm", label: copy.warm, help: copy.warmHelp },
];

/**
 * The approach's voice (1.1.111).
 *
 * Until 2026-09-11 this was an INDEPENDENT axis called "interaction style",
 * chosen on a persona or an activity by someone who could not see the teaching
 * approach it would land beside. The two contradicted each other in production:
 * three of ten live assignments did, most sharply `concise` ("do not end with a
 * follow-up question") against ESRU, 23 of whose 42 moves are ask-moves.
 *
 * It is now a property of the approach, chosen in the same editor as the moves —
 * and this component warns when the combination is one of the known-bad ones,
 * rather than letting the contradiction reach a student and be refereed by the
 * model.
 */
export function RegisterPicker({
  value,
  askMoveCount,
  onChange,
}: {
  value: FrameworkRegister | null | undefined;
  /** How many of this approach's behaviours ask or elicit — drives the warning. */
  askMoveCount?: number;
  onChange: (next: FrameworkRegister | null) => void;
}) {
  const elicitHeavy = (askMoveCount ?? 0) > 0;
  const warning =
    elicitHeavy && value === "concise" ? copy.clash : elicitHeavy && value === "warm" ? copy.clashWarm : null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{copy.label}</p>
      <p className="text-[11px] text-muted-foreground">{copy.help}</p>
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map((o) => {
          const selected = (value ?? "") === o.id;
          return (
            <button
              key={o.id || "none"}
              type="button"
              aria-pressed={selected}
              title={o.help}
              onClick={() => onChange(o.id === "" ? null : o.id)}
              className={
                selected
                  ? "rounded border border-brand bg-brand/10 px-2 py-1 text-xs font-medium"
                  : "rounded border border-border px-2 py-1 text-xs hover:bg-accent"
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {warning ? (
        <p
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
        >
          {warning}
        </p>
      ) : null}
    </div>
  );
}
