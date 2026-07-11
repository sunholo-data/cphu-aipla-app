"use client";

// CheckpointCard — the visible record of a tutor-run checkpoint (CONCEPT-1 M3).
// The model's record_checkpoint tool call renders as this card instead of a
// generic tool chip, so the student SEES what was marked and why (the trust
// principle: every check-off shows its evidence). Formative framing: a
// non-pass renders as "på vej" (progress), never as failure. This is the AI's
// read — the teacher can override it.

import { CheckCircle2, CircleDashed } from "lucide-react";

export interface CheckpointResult {
  nodeLabel: string;
  status: "demonstrated" | "partial";
  evidence: string;
}

/** Parse a record_checkpoint tool result into card data, or null (failed /
 *  malformed calls fall back to the generic chip). */
export function parseCheckpointResult(resultContent: string | null | undefined): CheckpointResult | null {
  if (!resultContent) return null;
  try {
    const r = JSON.parse(resultContent) as {
      ok?: boolean;
      node?: { label?: string };
      status?: string;
      evidence?: string;
    };
    if (!r.ok || !r.node?.label || (r.status !== "demonstrated" && r.status !== "partial")) return null;
    return { nodeLabel: r.node.label, status: r.status, evidence: typeof r.evidence === "string" ? r.evidence : "" };
  } catch {
    return null;
  }
}

export function CheckpointCard({ result }: { result: CheckpointResult }) {
  const demonstrated = result.status === "demonstrated";
  return (
    <div
      data-testid="checkpoint-card"
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
        demonstrated ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"
      }`}
    >
      {demonstrated ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      )}
      <div className="min-w-0">
        <p className={`font-medium ${demonstrated ? "text-emerald-900" : "text-amber-900"}`}>
          {result.nodeLabel} — {demonstrated ? "forstået" : "på vej"}
        </p>
        {result.evidence ? <p className="text-xs text-slate-600">{result.evidence}</p> : null}
      </div>
    </div>
  );
}
