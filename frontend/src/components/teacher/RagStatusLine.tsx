"use client";

// 1.1.151 F1c — whether the tutor can read a document, said in words.
//
// On 2026-09-07 a teacher's document failed its RAG upload; the upload route
// said "ingested", the materials list showed it like any other, and the tutor
// ran four weeks of lessons without it. M, 2026-10-05: "a UI to show it's
// definitely been ingested". So every place a teacher sees a document shows one
// of three states, and the failed one carries the way out ("Prøv igen").

import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { useLocaleMode, useT } from "@/i18n";
import {
  fetchCurriculumRagStatus,
  ragStatusOf,
  reingestCurriculumDoc,
  type CurriculumDoc,
  type RagStatusEntry,
} from "@/lib/curriculumApi";

/** How often to re-ask once an automatic retry is due, and for how long. */
const DUE_POLL_MS = 15_000;
const DUE_POLL_MAX = 20;

/**
 * 2026-10-06 — a failed upload is retried automatically on a schedule
 * (backend `db/curriculum_auto_retry.py`). The server can only run a retry
 * while something asks, so once the scheduled time passes this re-asks the
 * status — which starts the retry — and keeps asking until it lands.
 * Returns the freshest entry, or null before anything changed.
 */
export function useAutoRetryWatch(docId: string, nextRetryAt: string | null | undefined): RagStatusEntry | null {
  const [fresh, setFresh] = useState<RagStatusEntry | null>(null);
  // The caller's own copy moved on (a manual retry, a re-fetch): it wins.
  useEffect(() => setFresh(null), [docId, nextRetryAt]);
  const due = fresh ? fresh.ragNextRetryAt : nextRetryAt;
  const settled = fresh?.ragStatus === "ready";
  useEffect(() => {
    if (!due || settled) return;
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      polls += 1;
      try {
        const entry = (await fetchCurriculumRagStatus([docId]))[docId];
        if (cancelled || !entry) return;
        setFresh(entry);
        // A new schedule (it failed again) re-arms the effect via `due`.
        if (entry.ragStatus === "ready" || entry.ragNextRetryAt !== due) return;
      } catch {
        /* keep the last known state; try again below */
      }
      if (!cancelled && polls < DUE_POLL_MAX) timer = setTimeout(ask, DUE_POLL_MS);
    };
    const wait = Math.max(0, new Date(due).getTime() - Date.now()) + 2_000;
    timer = setTimeout(ask, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [docId, due, settled]);
  return fresh;
}

/** The watch as a component, for a list that keeps its own entries
 *  (FailedMaterialsWarning): renders nothing, reports what it learns. */
export function AutoRetryWatch({
  docId,
  nextRetryAt,
  onFresh,
}: {
  docId: string;
  nextRetryAt?: string | null;
  onFresh: (entry: RagStatusEntry) => void;
}) {
  const fresh = useAutoRetryWatch(docId, nextRetryAt);
  useEffect(() => {
    if (fresh) onFresh(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report each new entry once
  }, [fresh]);
  return null;
}

/** "Prøver igen automatisk kl. 11:42 · 2 automatiske forsøg indtil nu" — or,
 *  once the schedule has run out, how many were tried. Nothing when no
 *  automatic retry has been scheduled or run. */
export function AutoRetryNote({ nextRetryAt, autoRetries = 0 }: { nextRetryAt?: string | null; autoRetries?: number }) {
  const t = useT("RagStatusLine");
  const mode = useLocaleMode();
  if (!nextRetryAt && autoRetries === 0) return null;
  let main: string;
  if (nextRetryAt) {
    const at = new Date(nextRetryAt);
    main =
      at.getTime() <= Date.now()
        ? t("autoNow")
        : t("autoNext", {
            time: at.toLocaleTimeString(mode === "en" ? "en-GB" : "da-DK", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          });
  } else {
    main = t("autoGaveUp", { n: autoRetries });
  }
  return (
    <span className="text-muted-foreground" data-rag-auto-retry={nextRetryAt ? "scheduled" : "exhausted"}>
      {main}
      {nextRetryAt && autoRetries > 0 ? ` · ${t("autoCount", { n: autoRetries })}` : null}
    </span>
  );
}

interface Props {
  doc: CurriculumDoc;
  /** Called with the updated doc after a retry (whatever its outcome). */
  onUpdated?: (doc: CurriculumDoc) => void;
  /** False when the caller may not re-ingest (not the owner, not a researcher):
   *  the state is still shown, the button is not. */
  canRetry?: boolean;
}

export function RagStatusLine({ doc: given, onUpdated, canRetry = true }: Props) {
  const t = useT("RagStatusLine");
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const fresh = useAutoRetryWatch(given.docId, given.ragNextRetryAt);
  // A background retry that landed while this line was on screen.
  const doc: CurriculumDoc = fresh
    ? {
        ...given,
        ragStatus: fresh.ragStatus,
        ragError: fresh.ragError,
        ragNextRetryAt: fresh.ragNextRetryAt ?? null,
        ragAutoRetries: fresh.ragAutoRetries ?? given.ragAutoRetries,
      }
    : given;
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
      <span
        className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"
        data-rag-status="ready"
      >
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
      <AutoRetryNote nextRetryAt={doc.ragNextRetryAt} autoRetries={doc.ragAutoRetries} />
      {retryError ? <span className="text-destructive">{t("retryFailed")}</span> : null}
    </span>
  );
}
