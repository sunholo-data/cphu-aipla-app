"use client";

import { useState } from "react";
import { NotebookPen } from "lucide-react";

import { useT } from "@/i18n";
import { useSaveNotesAction, type SaveNotesOutcome } from "@/components/workspace/tutorNotes";

/**
 * "Gem som noter" under a tutor reply (1.1.151 F6).
 *
 * Renders only inside a student activity chat (the page provides the action);
 * a teacher chat or the builder preview has no provider and shows nothing.
 * The press is the student's — the tutor never writes into their document.
 * Where the text lands, and what to do when the activity has no writing
 * surface, is decided by `useSaveTutorNotes` in `components/workspace/tutorNotes`.
 */
export function SaveNotesButton({ text }: { text: string }) {
  const action = useSaveNotesAction();
  const t = useT("SaveNotesButton");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SaveNotesOutcome | null>(null);
  if (!action || !text.trim()) return null;

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setOutcome(await action.save(text));
    } finally {
      setBusy(false);
    }
  };

  const status = busy
    ? t("saving")
    : outcome === null
      ? null
      : outcome.kind === "saved" || outcome.kind === "unsaved" || outcome.kind === "full"
        ? t(outcome.kind, { title: outcome.title })
        : t(outcome.kind);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-label={action.target === "writing" ? t("ariaLabel") : t("ariaLabelCopy")}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
        {t("label")}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {status}
      </span>
    </div>
  );
}
