"use client";

import type { FrameworkRegister } from "@/lib/teacherApi";
import { useT } from "@/i18n";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
// UI copy lives in messages/*/teacher-research.json (RegisterPicker) — 1.1.108 M4.
// ⚠️ `clash` / `clashWarm` are the warning that is the whole reason this control moved here.

const OPTIONS: { id: FrameworkRegister | ""; label: "none" | "concise" | "rigorous" | "warm"; help: "noneHelp" | "conciseHelp" | "rigorousHelp" | "warmHelp" }[] = [
  { id: "", label: "none", help: "noneHelp" },
  { id: "concise", label: "concise", help: "conciseHelp" },
  { id: "rigorous", label: "rigorous", help: "rigorousHelp" },
  { id: "warm", label: "warm", help: "warmHelp" },
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
  const t = useT("RegisterPicker");
  const elicitHeavy = (askMoveCount ?? 0) > 0;
  const warning =
    elicitHeavy && value === "concise" ? t("clash") : elicitHeavy && value === "warm" ? t("clashWarm") : null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{t("label")}</p>
      <p className="text-[11px] text-muted-foreground">{t("help")}</p>
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map((o) => {
          const selected = (value ?? "") === o.id;
          return (
            <button
              key={o.id || "none"}
              type="button"
              aria-pressed={selected}
              title={t(o.help)}
              onClick={() => onChange(o.id === "" ? null : o.id)}
              className={
                selected
                  ? "rounded border border-brand bg-brand/10 px-2 py-1 text-xs font-medium"
                  : "rounded border border-border px-2 py-1 text-xs hover:bg-accent"
              }
            >
              {t(o.label)}
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
