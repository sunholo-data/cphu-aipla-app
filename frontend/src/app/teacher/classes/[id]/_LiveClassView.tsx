"use client";

/**
 * LiveClassView (1.1.31 M0, un-gated) — the in-lesson teacher dashboard.
 *
 * Polls GET /api/classes/{id}/live (~10s) and shows, for the class right now:
 *   - Calls: incoming raised hands (1.1.29), each with Acknowledge
 *   - Summary: the rolling class summary (1.1.31 M1) — only when present
 *   - Groups: deterministic per-group signals (active/idle, turns, stuck)
 *
 * Graceful degradation (Axiom 5): the deterministic layer renders even if the
 * summary is absent/failed; the whole view degrades to an alert only if the
 * fetch itself fails before any data arrives.
 */

import { Hand, Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { SettingsSection } from "@/components/teacher/ui";
import { ackClassSignal, listClassLive, type LiveClass } from "@/lib/teacherApi";

function relTime(iso: string): string {
  if (!iso) return "";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  return mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`;
}

export function LiveClassView({ classId, pollMs = 10_000 }: { classId: string; pollMs?: number }) {
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
    void refresh();
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs]);

  async function ack(groupId: string) {
    setAcking(groupId);
    try {
      await ackClassSignal(classId, groupId);
      await refresh();
    } finally {
      setAcking(null);
    }
  }

  if (data === null) {
    return (
      <SettingsSection title="Live">
        {error ? (
          <p role="alert" className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            Could not load live status. Retrying…
          </p>
        ) : (
          <p data-testid="live-loading" className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading live status…
          </p>
        )}
      </SettingsSection>
    );
  }

  const { calls, groups, summary } = data;

  return (
    <SettingsSection title="Live">
      <div data-testid="live-class-view" className="flex flex-col gap-4">
        {/* Calls (raised hands) */}
        {calls.length > 0 && (
          <ul className="divide-y divide-border rounded border border-amber-300 bg-amber-50/50">
            {calls.map((c) => (
              <li key={c.groupId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-amber-800">
                  <Hand className="h-4 w-4" aria-hidden />
                  <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono">{c.groupId}</code>
                  {c.activityTitle && <span className="text-amber-700">· {c.activityTitle}</span>}
                  <span className="text-xs text-amber-600">{relTime(c.raisedHandAt)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void ack(c.groupId)}
                  disabled={acking === c.groupId}
                  className="rounded border border-amber-400 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  {acking === c.groupId ? "…" : "Acknowledge"}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Rolling class summary (1.1.31 M1) — only when present */}
        {summary && (
          <div className="rounded border border-border bg-muted/40 px-3 py-2 text-sm" data-testid="live-summary">
            <p className="text-foreground">{summary.text}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              AI · {summary.framework} · updated {relTime(summary.generatedAt)}
            </p>
          </div>
        )}

        {/* Deterministic per-group signals */}
        {groups.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No groups online yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {groups.map((g) => (
              <li key={g.groupId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`h-2 w-2 rounded-full ${g.status === "active" ? "bg-green-500" : "bg-gray-300"}`}
                  />
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{g.groupId}</code>
                  <span className="text-muted-foreground">{g.status}</span>
                  {g.activityTitle && <span className="text-muted-foreground">· {g.activityTitle}</span>}
                </span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{g.turns} turns</span>
                  {g.stuck && (
                    <span className="flex items-center gap-1 text-amber-700">
                      <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> stuck
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}
