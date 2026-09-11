/**
 * ClassInsightsPanel — the per-class dashboard panel rendered above
 * "Recent activity" on /teacher/classes/[id].
 *
 * Layout:
 *   - 6-card KPI grid (one row of `KpiCard` per metric)
 *   - 7-day messages trend (`TrendSparkline`)
 *   - Per-group engagement bar (`EngagementBar`)
 *   - Per-activity engagement bar (`EngagementBar`, two series)
 *
 * Each section fetches independently via `useInsightsFetch` so one
 * slow query does not block the rest of the panel rendering. Per-card
 * errors render an inline note and leave the surrounding panel intact
 * (axiom 1 — INSTANT FEEL + per-card error boundary).
 */

"use client";

import { AlertCircle } from "lucide-react";

import { useState } from "react";

import { EngagementBar } from "./EngagementBar";
import { KpiCard } from "./KpiCard";
import { TrendSparkline } from "./TrendSparkline";
import { useInsightsFetch } from "@/hooks/useInsights";
import {
  fetchInsightsClassActivities,
  fetchInsightsClassGroups,
  fetchInsightsClassKpis,
  fetchInsightsClassTrend,
  type InsightsSince,
} from "@/lib/insightsApi";

interface ClassInsightsPanelProps {
  classId: string;
  /** Initial window; the panel carries its own selector from here. */
  since?: InsightsSince;
}

// Copy lives here rather than inline in JSX — the 1.1.108 rule.
const copy = {
  windowLabel: "Time window",
  windowOption: { "7d": "7 days", "30d": "30 days", all: "All time" } as Record<InsightsSince, string>,
  windowPhrase: { "7d": "the last 7 days", "30d": "the last 30 days", all: "all time" } as Record<
    InsightsSince,
    string
  >,
  // Said in words on purpose. An empty grid of zeros reads the same as a
  // read that failed or a class the caller may not see, and a researcher
  // cannot tell them apart — the footgun table's "checker that answers when
  // it could not read", applied to a UI. The error case is the amber alert
  // above; this is the genuine, verified absence.
  nothingYet: (w: string) => `No student has sent a message in this class in ${w}.`,
  nothingYetHint: "Widen the window, or check the class has a join code students have used.",
};

const KPI_DEFINITIONS: Record<string, string> = {
  activeGroups: "Groups with at least one message in this window.",
  totalMessages: "Total chat turns this class produced in this window.",
  activeActivities: "Activities (skills) with at least one message or sim run.",
  simRuns: "Workbench sim executions across all groups.",
  medianTimeOnTaskMin: "Median minutes-per-session across groups.",
  lastActivity: "Most recent chat turn timestamp.",
};

export function ClassInsightsPanel({ classId, since: initialSince = "30d" }: ClassInsightsPanelProps) {
  const [since, setSince] = useState<InsightsSince>(initialSince);
  const kpis = useInsightsFetch(() => fetchInsightsClassKpis(classId, since), [classId, since]);
  const groups = useInsightsFetch(() => fetchInsightsClassGroups(classId, since), [classId, since]);
  const activities = useInsightsFetch(() => fetchInsightsClassActivities(classId, since), [classId, since]);
  const trend = useInsightsFetch(() => fetchInsightsClassTrend(classId, since), [classId, since]);

  const kpiQueries = kpis.data?._debug.queries ?? [];

  return (
    <section
      aria-labelledby="insights-panel-label"
      data-testid="class-insights-panel"
      className="flex flex-col gap-4 rounded border border-border bg-background p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="insights-panel-label" className="text-lg font-semibold">
          Class insights
        </h2>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{copy.windowLabel}</span>
          <select
            value={since}
            onChange={(e) => setSince(e.target.value as InsightsSince)}
            aria-label={copy.windowLabel}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            {(["7d", "30d", "all"] as InsightsSince[]).map((w) => (
              <option key={w} value={w}>
                {copy.windowOption[w]}
              </option>
            ))}
          </select>
        </label>
      </header>

      {kpis.data && kpis.data.kpis.totalMessages === 0 && kpis.data.kpis.simRuns === 0 ? (
        <p
          data-testid="insights-nothing-yet"
          className="rounded border border-dashed border-border px-3 py-3 text-sm text-muted-foreground"
        >
          {copy.nothingYet(copy.windowPhrase[since])}{" "}
          <span className="text-xs">{copy.nothingYetHint}</span>
        </p>
      ) : null}

      <Section title="At a glance" loading={kpis.isLoading} error={kpis.error}>
        {kpis.data ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <KpiCard
              label="Active groups"
              value={kpis.data.kpis.activeGroups}
              definition={KPI_DEFINITIONS.activeGroups!}
              queries={kpiQueries.filter((q) => q.name === "count_messages")}
            />
            <KpiCard
              label="Total messages"
              value={kpis.data.kpis.totalMessages}
              definition={KPI_DEFINITIONS.totalMessages!}
              queries={kpiQueries.filter((q) => q.name === "count_messages")}
            />
            <KpiCard
              label="Active activities"
              value={kpis.data.kpis.activeActivities}
              definition={KPI_DEFINITIONS.activeActivities!}
              queries={kpiQueries.filter((q) => q.name === "sim_runs_per_skill" || q.name === "time_on_task")}
            />
            <KpiCard
              label="Sim runs"
              value={kpis.data.kpis.simRuns}
              definition={KPI_DEFINITIONS.simRuns!}
              queries={kpiQueries.filter((q) => q.name === "sim_runs_per_skill")}
            />
            <KpiCard
              label="Median time on task"
              value={kpis.data.kpis.medianTimeOnTaskMin}
              unit="min"
              definition={KPI_DEFINITIONS.medianTimeOnTaskMin!}
              queries={kpiQueries.filter((q) => q.name === "time_on_task")}
            />
            <KpiCard
              label="Last activity"
              value={formatRelative(kpis.data.kpis.lastActivity)}
              definition={KPI_DEFINITIONS.lastActivity!}
              queries={kpiQueries.filter((q) => q.name === "time_on_task")}
            />
          </div>
        ) : null}
      </Section>

      <Section title="Trend" loading={trend.isLoading} error={trend.error}>
        {trend.data ? <TrendSparkline points={trend.data.perDay} /> : null}
      </Section>

      <Section title="Groups" loading={groups.isLoading} error={groups.error}>
        {groups.data ? (
          <EngagementBar
            title="Per-group activity"
            primaryLabel="Messages"
            rows={groups.data.groups.map((g) => ({ label: g.groupCode, value: g.messageCount }))}
            hrefFor={(r) => `/teacher/reports/groups/${r.label}`}
          />
        ) : null}
      </Section>

      <Section title="Activities" loading={activities.isLoading} error={activities.error}>
        {activities.data ? (
          <EngagementBar
            title="Per-activity engagement"
            primaryLabel="Active groups"
            secondaryLabel="Sim runs"
            rows={activities.data.activities.map((a) => ({
              label: a.skillId,
              value: a.activeGroups,
              secondaryValue: a.simRuns,
            }))}
          />
        ) : null}
      </Section>
    </section>
  );
}

function Section({
  title,
  loading,
  error,
  children,
}: {
  title: string;
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  if (error) {
    return (
      <div data-testid={`section-error-${title.toLowerCase()}`} role="alert" className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-medium">{title} unavailable.</span> {error}
        </p>
      </div>
    );
  }
  if (loading) {
    return (
      <div data-testid={`section-loading-${title.toLowerCase()}`} className="rounded border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Loading {title.toLowerCase()}…
      </div>
    );
  }
  return <>{children}</>;
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
