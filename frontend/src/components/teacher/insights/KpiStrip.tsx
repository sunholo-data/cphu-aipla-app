/**
 * KpiStrip — one-line "Active groups · Messages 7d · Last activity"
 * shown under each class card on /teacher/classes.
 *
 * Reads from `/api/insights/summary` (one round-trip for the whole
 * dashboard, not N-per-card). The parent page fetches once and
 * passes the matching `InsightsClassSummary` in.
 *
 * Empty state when no data has loaded yet — gracefully degrades to
 * the existing card text rather than blocking render.
 */

"use client";

import { Activity, MessageSquare, Users } from "lucide-react";

import type { InsightsClassSummary } from "@/lib/insightsApi";

interface KpiStripProps {
  summary: InsightsClassSummary | undefined;
}

export function KpiStrip({ summary }: KpiStripProps) {
  if (!summary) {
    return (
      <p data-testid="kpi-strip-loading" className="text-xs text-muted-foreground">
        Loading engagement…
      </p>
    );
  }

  return (
    <dl
      data-testid="kpi-strip"
      className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
    >
      <Stat icon={<Users className="h-3.5 w-3.5" aria-hidden="true" />} label="Active groups">
        {summary.activeGroups}
      </Stat>
      <Stat icon={<MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />} label="Messages 7d">
        {summary.totalMessages}
      </Stat>
      <Stat icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />} label="Last activity">
        {formatRelative(summary.lastActivity)}
      </Stat>
    </dl>
  );
}

function Stat({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1">
      {icon}
      <dt className="sr-only">{label}</dt>
      <dd className="tabular-nums">
        <span className="font-medium text-foreground">{children}</span>
        <span className="ml-1 text-muted-foreground">{label.toLowerCase()}</span>
      </dd>
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "none";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diffMin = Math.round((Date.now() - t) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}h ago`;
  return `${Math.round(diffMin / 60 / 24)}d ago`;
}
