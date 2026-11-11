"use client";

/**
 * The live half of the class page's Lektion view (1.1.31 M0, un-gated;
 * reshaped by the 2026-11 UI sweep).
 *
 * Polls GET /api/classes/{id}/live (~10s). The poll used to drive its own
 * "Live" section with a third list of the class's groups; since the sweep the
 * per-group signals (active / quiet / stuck, messages, last active) are columns
 * of the ONE groups table (`_GroupsTable.tsx`), and this file keeps:
 *   - `useLiveClass` — the poll, plus Acknowledge;
 *   - `RaisedHands`  — incoming raised hands (1.1.29), each with Kvittér;
 *   - `LiveSummary`  — the rolling class summary (1.1.31 M1), only when present.
 *
 * Graceful degradation (Axiom 5): the groups table renders from the class even
 * if this poll fails — the status column then says it does not know.
 */

import { Hand } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { ackClassSignal, listClassLive, type LiveCall, type LiveClass } from "@/lib/teacherApi";
import { useT, type Translate } from "@/i18n";

export function relTime(iso: string, t: Translate<"LiveClassView">): string {
  if (!iso) return "";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return t("secondsAgo", { n: secs });
  const mins = Math.round(secs / 60);
  return mins < 60 ? t("minutesAgo", { n: mins }) : t("hoursAgo", { n: Math.round(mins / 60) });
}

export interface LiveClassState {
  /** null until the first answer. */
  data: LiveClass | null;
  /** The last poll failed (the next one retries on its own). */
  error: boolean;
  /** The group whose hand is being acknowledged right now. */
  acking: string | null;
  ack: (groupId: string) => Promise<void>;
}

export function useLiveClass(classId: string, pollMs = 10_000): LiveClassState {
  const t = useT("LiveClassView");
  const [data, setData] = useState<LiveClass | null>(null);
  const [error, setError] = useState(false);
  const [acking, setAcking] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await listClassLive(classId));
      setError(false);
    } catch {
      setError(true);
    }
  }, [classId]);

  useEffect(() => {
    if (!classId) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(id);
  }, [classId, refresh, pollMs]);

  const ack = useCallback(
    async (groupId: string) => {
      setAcking(groupId);
      try {
        await ackClassSignal(classId, groupId);
        await refresh();
      } catch {
        // Used to be an unhandled rejection: the click silently did nothing.
        notify.error(t("ackFailed", { code: groupId }));
      } finally {
        setAcking(null);
      }
    },
    [classId, refresh, t],
  );

  return { data, error, acking, ack };
}

/** Raised hands, newest attention first. Renders nothing when there are none. */
export function RaisedHands({
  calls,
  acking,
  onAck,
}: {
  calls: LiveCall[];
  acking: string | null;
  onAck: (groupId: string) => void;
}) {
  const t = useT("LiveClassView");
  if (calls.length === 0) return null;
  return (
    <ul data-testid="raised-hands" className="divide-y divide-border rounded border border-amber-300 bg-amber-50/50 dark:bg-amber-950/30">
      {calls.map((c) => (
        <li key={c.groupId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="flex flex-wrap items-center gap-2 text-sm text-amber-900 dark:text-amber-100">
            <Hand className="h-4 w-4" aria-hidden />
            <Link
              href={`/teacher/reports/groups/${encodeURIComponent(c.groupId)}`}
              className="rounded bg-amber-100 px-1.5 py-0.5 font-mono underline-offset-2 hover:underline dark:bg-amber-900"
            >
              {c.groupId}
            </Link>
            <span>{t("raisedHand")}</span>
            {c.activityTitle && <span className="text-amber-800 dark:text-amber-200">· {c.activityTitle}</span>}
            <span className="text-xs text-amber-700 dark:text-amber-300">{relTime(c.raisedHandAt, t)}</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onAck(c.groupId)}
            pending={acking === c.groupId}
            aria-label={t("ackAria", { code: c.groupId })}
          >
            {t("acknowledge")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** The rolling class summary (1.1.31 M1) — only when the backend sends one. */
export function LiveSummary({ summary }: { summary: LiveClass["summary"] }) {
  const t = useT("LiveClassView");
  if (!summary) return null;
  return (
    <div className="rounded border border-border bg-muted/40 px-3 py-2 text-sm" data-testid="live-summary">
      <p className="text-xs font-medium text-muted-foreground">{t("summaryTitle")}</p>
      <div className="text-foreground">
        <ChatMarkdown content={summary.text} navigateToBlock={() => {}} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("summaryMeta", { framework: summary.framework, when: relTime(summary.generatedAt, t) })}
      </p>
    </div>
  );
}
