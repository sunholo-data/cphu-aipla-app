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
import { useT, type Translate } from "@/i18n";

interface ClassInsightsPanelProps {
  classId: string;
  /** Initial window; the panel carries its own selector from here. */
  since?: InsightsSince;
}

// Copy lives in messages/*/teacher-research.json (ClassInsightsPanel) — 1.1.108.
//
// "nothingYet" is said in words on purpose. An empty grid of zeros reads the
// same as a read that failed or a class the caller may not see, and a
// researcher cannot tell them apart — the footgun table's "checker that answers
// when it could not read", applied to a UI. The error case is the amber alert;
// this is the genuine, verified absence.

export function ClassInsightsPanel({ classId, since: initialSince = "30d" }: ClassInsightsPanelProps) {
  const t = useT("ClassInsightsPanel");
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
          {t("title")}
        </h2>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("windowLabel")}</span>
          <select
            value={since}
            onChange={(e) => setSince(e.target.value as InsightsSince)}
            aria-label={t("windowLabel")}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            {(["7d", "30d", "all"] as InsightsSince[]).map((w) => (
              <option key={w} value={w}>
                {t(`window_${w}`)}
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
          {t("nothingYet", { window: t(`phrase_${since}`) })}{" "}
          <span className="text-xs">{t("nothingYetHint")}</span>
        </p>
      ) : null}

      <Section id="glance" title={t("sectionGlance")} loading={kpis.isLoading} error={kpis.error}>
        {kpis.data ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <KpiCard
              label={t("kpiActiveGroups")}
              value={kpis.data.kpis.activeGroups}
              definition={t("defActiveGroups")}
              queries={kpiQueries.filter((q) => q.name === "count_messages")}
            />
            <KpiCard
              label={t("kpiTotalMessages")}
              value={kpis.data.kpis.totalMessages}
              definition={t("defTotalMessages")}
              queries={kpiQueries.filter((q) => q.name === "count_messages")}
            />
            <KpiCard
              label={t("kpiActiveActivities")}
              value={kpis.data.kpis.activeActivities}
              definition={t("defActiveActivities")}
              queries={kpiQueries.filter((q) => q.name === "sim_runs_per_skill" || q.name === "time_on_task")}
            />
            <KpiCard
              label={t("kpiSimRuns")}
              value={kpis.data.kpis.simRuns}
              definition={t("defSimRuns")}
              queries={kpiQueries.filter((q) => q.name === "sim_runs_per_skill")}
            />
            <KpiCard
              label={t("kpiMedianTime")}
              value={kpis.data.kpis.medianTimeOnTaskMin}
              unit={t("unitMin")}
              definition={t("defMedianTime")}
              queries={kpiQueries.filter((q) => q.name === "time_on_task")}
            />
            <KpiCard
              label={t("kpiLastActivity")}
              value={formatRelative(kpis.data.kpis.lastActivity, t)}
              definition={t("defLastActivity")}
              queries={kpiQueries.filter((q) => q.name === "time_on_task")}
            />
          </div>
        ) : null}
      </Section>

      <Section id="trend" title={t("sectionTrend")} loading={trend.isLoading} error={trend.error}>
        {trend.data ? <TrendSparkline points={trend.data.perDay} /> : null}
      </Section>

      <Section id="groups" title={t("sectionGroups")} loading={groups.isLoading} error={groups.error}>
        {groups.data ? (
          <EngagementBar
            title={t("perGroupTitle")}
            primaryLabel={t("messages")}
            rows={groups.data.groups.map((g) => ({ label: g.groupCode, value: g.messageCount }))}
            hrefFor={(r) => `/teacher/reports/groups/${r.label}`}
          />
        ) : null}
      </Section>

      <Section id="activities" title={t("sectionActivities")} loading={activities.isLoading} error={activities.error}>
        {activities.data ? (
          <EngagementBar
            title={t("perActivityTitle")}
            primaryLabel={t("activeGroups")}
            secondaryLabel={t("simRuns")}
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
  id,
  title,
  loading,
  error,
  children,
}: {
  /** Stable, untranslated id for test hooks. */
  id: string;
  title: string;
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  const t = useT("ClassInsightsPanel");
  if (error) {
    return (
      <div data-testid={`section-error-${id}`} role="alert" className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-medium">{t("unavailable", { section: title })}</span> {error}
        </p>
      </div>
    );
  }
  if (loading) {
    return (
      <div data-testid={`section-loading-${id}`} className="rounded border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        {t("loading", { section: title.toLowerCase() })}
      </div>
    );
  }
  return <>{children}</>;
}

function formatRelative(iso: string | null, t: Translate<"ClassInsightsPanel">): string {
  if (!iso) return t("none");
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const diffMin = Math.round((Date.now() - at) / 60_000);
  if (diffMin < 1) return t("justNow");
  if (diffMin < 60) return t("minAgo", { n: diffMin });
  if (diffMin < 60 * 24) return t("hoursAgo", { n: Math.round(diffMin / 60) });
  return t("daysAgo", { n: Math.round(diffMin / 60 / 24) });
}
