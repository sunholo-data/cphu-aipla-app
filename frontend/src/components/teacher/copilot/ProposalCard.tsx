"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";

import { DEFAULT_LABELS, type CopilotLabels, type ProposalDescriptor } from "./types";

/**
 * Apply / Edit / Dismiss card for ONE proposal — generic over the surface's
 * proposal type via a `ProposalDescriptor`. Nothing is committed until the
 * teacher clicks Apply (`onApply`); Edit lets free-text kinds be revised first;
 * Dismiss discards. This is the earned-trust contract shared by every teacher
 * co-pilot.
 */
export function ProposalCard<P>({
  proposal,
  descriptor,
  onApply,
  labels: labelsOverride,
}: {
  proposal: P;
  descriptor: ProposalDescriptor<P>;
  onApply: (proposal: P) => void | Promise<void>;
  labels?: Partial<CopilotLabels>;
}) {
  const labels: CopilotLabels = { ...DEFAULT_LABELS, ...labelsOverride };
  const [applied, setApplied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState(false);
  const editable = descriptor.editableText?.(proposal) ?? null;
  const canEdit = editable !== null && typeof descriptor.withEditedText === "function";
  const [draft, setDraft] = useState(editable ?? "");

  if (dismissed) return null;
  if (applied) {
    return (
      <div role="status" className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        {labels.applied}
      </div>
    );
  }

  return (
    <div data-testid="proposal-card" className="flex flex-col gap-2 rounded border border-border bg-muted/40 p-3 text-sm">
      <p className="text-xs font-medium text-muted-foreground">{descriptor.title(proposal)}</p>
      {editing && editable !== null ? (
        <textarea
          aria-label="Edit proposal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
        />
      ) : editable !== null ? (
        <p className="whitespace-pre-wrap">{editable}</p>
      ) : descriptor.body ? (
        descriptor.body(proposal)
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            const toApply = editing && descriptor.withEditedText ? descriptor.withEditedText(proposal, draft) : proposal;
            void onApply(toApply);
            setApplied(true);
          }}
          className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> {editing ? labels.useEdited : labels.apply}
        </button>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {labels.edit}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" /> {labels.dismiss}
        </button>
      </div>
    </div>
  );
}
