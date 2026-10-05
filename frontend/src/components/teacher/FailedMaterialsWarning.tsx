"use client";

// 1.1.151 F1c — a document the tutor cannot read, said where the teacher plans
// the lesson: on the activity card and in the class view. Finding out in the
// materials list is not enough — the teacher has to find out BEFORE the lesson,
// and the activity is what they look at then.

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useT } from "@/i18n";
import {
  fetchCurriculumRagStatus,
  reingestCurriculumDoc,
  ragStatusOf,
  type RagStatusEntry,
} from "@/lib/curriculumApi";
import type { MaterialRef } from "@/lib/teacherApi";

/** The curriculum doc ids an activity cites (images carry no doc). */
export function citedDocIds(materials: MaterialRef[] | undefined | null): string[] {
  return (materials ?? []).filter((m) => (m.kind ?? "curriculum") !== "image" && m.docId).map((m) => m.docId);
}

/** One batch fetch of RAG status for every doc a page's activities cite.
 *  Errors leave the map empty — a missing warning, never a false one. */
export function useRagStatuses(docIds: string[]) {
  const key = useMemo(() => Array.from(new Set(docIds)).sort().join("|"), [docIds]);
  const [statuses, setStatuses] = useState<Record<string, RagStatusEntry>>({});
  useEffect(() => {
    if (!key) {
      setStatuses({});
      return;
    }
    let cancelled = false;
    fetchCurriculumRagStatus(key.split("|"))
      .then((s) => {
        if (!cancelled) setStatuses(s);
      })
      .catch(() => {
        if (!cancelled) setStatuses({});
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  const update = useCallback((docId: string, entry: RagStatusEntry) => {
    setStatuses((prev) => ({ ...prev, [docId]: entry }));
  }, []);
  return { statuses, update };
}

interface Props {
  materials: MaterialRef[] | undefined | null;
  statuses: Record<string, RagStatusEntry>;
  onUpdated: (docId: string, entry: RagStatusEntry) => void;
}

export function FailedMaterialsWarning({ materials, statuses, onUpdated }: Props) {
  const t = useT("FailedMaterialsWarning");
  const tl = useT("RagStatusLine");
  const [busy, setBusy] = useState<string | null>(null);
  const failed = citedDocIds(materials)
    .filter((id, i, all) => all.indexOf(id) === i)
    .map((id) => [id, statuses[id]] as const)
    .filter(([, s]) => s?.ragStatus === "failed");
  if (failed.length === 0) return null;

  async function retry(docId: string, entry: RagStatusEntry) {
    setBusy(docId);
    try {
      const doc = await reingestCurriculumDoc(docId);
      onUpdated(docId, { ...entry, ragStatus: ragStatusOf(doc), ragError: doc.ragError ?? null });
    } catch {
      // The entry stays failed; the warning stays up — the honest state.
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs"
      data-testid="failed-materials-warning"
    >
      <p className="flex items-center gap-1 font-medium text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {t("heading", { count: failed.length })}
      </p>
      <ul className="flex flex-col gap-1">
        {failed.map(([id, entry]) => (
          <li key={id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{entry.title}</span>
            {entry.canRetry ? (
              <button
                type="button"
                onClick={() => void retry(id, entry)}
                disabled={busy === id}
                aria-label={tl("retryAria", { title: entry.title })}
                className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 font-medium hover:bg-muted disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                {busy === id ? tl("retrying") : tl("retry")}
              </button>
            ) : (
              <span className="text-muted-foreground">{t("askOwner")}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{t("help")}</p>
    </div>
  );
}
