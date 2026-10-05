"use client";

// 1.1.151 F1c — whether the tutor can read a document, said in words.
//
// On 2026-09-07 a teacher's document failed its RAG upload; the upload route
// said "ingested", the materials list showed it like any other, and the tutor
// ran four weeks of lessons without it. M, 2026-10-05: "a UI to show it's
// definitely been ingested". So every place a teacher sees a document shows one
// of three states, and the failed one carries the way out ("Prøv igen").

import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { useT } from "@/i18n";
import { ragStatusOf, reingestCurriculumDoc, type CurriculumDoc } from "@/lib/curriculumApi";

interface Props {
  doc: CurriculumDoc;
  /** Called with the updated doc after a retry (whatever its outcome). */
  onUpdated?: (doc: CurriculumDoc) => void;
  /** False when the caller may not re-ingest (not the owner, not a researcher):
   *  the state is still shown, the button is not. */
  canRetry?: boolean;
}

export function RagStatusLine({ doc, onUpdated, canRetry = true }: Props) {
  const t = useT("RagStatusLine");
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const status = busy ? "pending" : ragStatusOf(doc);

  async function retry() {
    setBusy(true);
    setRetryError(false);
    try {
      const updated = await reingestCurriculumDoc(doc.docId);
      onUpdated?.(updated);
      if (ragStatusOf(updated) !== "ready") setRetryError(true);
    } catch {
      setRetryError(true);
    } finally {
      setBusy(false);
    }
  }

  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400" data-rag-status="ready">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        {t("ready")}
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-rag-status="pending">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        {busy ? t("retrying") : t("pending")}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" data-rag-status="failed">
      <span
        className="inline-flex items-center gap-1 font-medium text-destructive"
        title={doc.ragError ? t("errorTitle", { error: doc.ragError }) : undefined}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        {t("failed")}
      </span>
      {canRetry ? (
        <button
          type="button"
          onClick={() => void retry()}
          disabled={busy}
          aria-label={t("retryAria", { title: doc.title })}
          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-medium hover:bg-muted disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          {t("retry")}
        </button>
      ) : null}
      {retryError ? <span className="text-destructive">{t("retryFailed")}</span> : null}
    </span>
  );
}
