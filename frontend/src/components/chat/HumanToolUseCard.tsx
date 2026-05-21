// HumanToolUseCard — chip-style affordance for student workspace actions.
//
// The visual mirror of ToolCallChip but for human tool-use. Renders when
// the student clicks a workspace surface (BoldkastSimFrame marker reveal,
// ProgressChecklist toggle) — the act of pushing iframe-context to the
// agent. Three states: pending (POST in flight), confirmed (204), failed
// (4xx/5xx or network). The failed state is the whole point — if it
// surfaces, the student knows the AI didn't catch this action, and the
// dev knows the 2026-05-21 iframe-context 404 has regressed.
//
// Per project convention: lucide-react icons, no emoji.
// See: docs/design/aipla/v0.1.0-jutland/human-tool-use-cards.md

"use client";

import { AlertTriangle, Check, Loader2, User } from "lucide-react";

export type HumanToolUseStatus = "pending" | "confirmed" | "failed";

export interface HumanToolUseCardProps {
  /** Danish label shown inside the chip (e.g. "Markerede 'a' som klar",
   *  "Afslørede y_max"). Truncated to 80 chars in the render to keep the
   *  chip on one line. */
  label: string;
  status: HumanToolUseStatus;
  /** HTTP status from the iframe-context push (only set on failed).
   *  Shown in the title attribute so hover reveals "POST … → 404". */
  httpStatus?: number;
  /** Free-form detail (typically "network" for fetch rejections). Also
   *  surfaces via the title attribute. */
  detail?: string;
}

const MAX_LABEL_CHARS = 80;

export function HumanToolUseCard({ label, status, httpStatus, detail }: HumanToolUseCardProps) {
  const shown = label.length > MAX_LABEL_CHARS ? label.slice(0, MAX_LABEL_CHARS) + "…" : label;
  const titleParts: string[] = [];
  if (httpStatus !== undefined) titleParts.push(`HTTP ${httpStatus}`);
  if (detail) titleParts.push(detail);
  const title = titleParts.length > 0 ? titleParts.join(" — ") : undefined;

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground"
      data-testid="human-tool-use-card"
      data-status={status}
      title={title}
    >
      <User className="h-3 w-3 shrink-0" aria-label="You" />
      <span>{shown}</span>
      {status === "pending" && (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-orange-500" aria-label="Pending" />
      )}
      {status === "confirmed" && (
        <Check className="h-3 w-3 shrink-0 text-green-600" aria-label="Confirmed" />
      )}
      {status === "failed" && (
        <AlertTriangle className="h-3 w-3 shrink-0 text-red-600" aria-label="Failed" />
      )}
    </div>
  );
}
