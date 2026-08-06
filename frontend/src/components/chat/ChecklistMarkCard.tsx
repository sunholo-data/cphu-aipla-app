"use client";

// ChecklistMarkCard — the visible record of a tutor-marked checklist step
// (1.1.62 M3). The model's mark_checklist_item tool call renders as this card
// instead of an opaque tool chip, so the student SEES which step was marked and
// WHY.
//
// This is the trust half of "the AI helps auto-grade" (M, 2026-08-06). The
// tutor may now mark the teacher's ILOs from evidence in the conversation, and
// the only thing that keeps that honest is the student seeing every mark, with
// its reason, and being able to undo it in the workbench. A silent state change
// would be worse than no feature.
//
// Sibling of CheckpointCard (CONCEPT-1 M3) — same principle, different element.

import { CheckCircle2, CircleDashed, Sparkles } from "lucide-react";

export interface ChecklistMarkResult {
  itemLabel: string;
  done: boolean;
  evidence: string;
}

/** Parse a mark_checklist_item tool result into card data, or null (failed /
 *  malformed calls fall back to the generic chip). */
export function parseChecklistMarkResult(
  resultContent: string | null | undefined,
): ChecklistMarkResult | null {
  if (!resultContent) return null;
  try {
    const r = JSON.parse(resultContent) as {
      ok?: boolean;
      item?: { label?: string };
      done?: boolean;
      evidence?: string;
    };
    if (!r.ok || !r.item?.label || typeof r.done !== "boolean") return null;
    return {
      itemLabel: r.item.label,
      done: r.done,
      evidence: typeof r.evidence === "string" ? r.evidence : "",
    };
  } catch {
    return null;
  }
}

export function ChecklistMarkCard({ result }: { result: ChecklistMarkResult }) {
  return (
    <div
      data-testid="checklist-mark-card"
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
        result.done ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50/60"
      }`}
    >
      {result.done ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
      )}
      <div className="min-w-0">
        <p className={`flex items-center gap-1 font-medium ${result.done ? "text-emerald-900" : "text-slate-800"}`}>
          <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
          {result.done ? `Markeret som klar: ${result.itemLabel}` : `Ikke længere klar: ${result.itemLabel}`}
        </p>
        {result.evidence ? <p className="text-xs text-slate-600">{result.evidence}</p> : null}
        {/* The override is the point — say so where the student is looking. */}
        <p className="mt-0.5 text-[10px] text-slate-500">
          Du kan ændre markeringen i din oversigt.
        </p>
      </div>
    </div>
  );
}
