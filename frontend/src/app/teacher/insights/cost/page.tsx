/**
 * /teacher/insights/cost — cross-class spend overview (sprint 1.1.9).
 *
 * Researcher-only: the backend `/api/insights/cost` 403s without the
 * researcher claim, and the page renders an access notice for
 * non-researchers rather than firing the call. Totals + per-cohort +
 * per-model + per-class spend across every class.
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import {
  type CostInsightsPayload,
  type SpendPeriod,
  fetchCostInsights,
  formatEur,
} from "@/lib/costApi";

const PERIOD_LABEL: Record<SpendPeriod, string> = {
  this_month: "This month",
  last_month: "Last month",
  all_time: "All time",
};

export default function TeacherCostInsightsPage() {
  const isResearcher = useIsResearcher();
  const [period, setPeriod] = useState<SpendPeriod>("this_month");
  const [payload, setPayload] = useState<CostInsightsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isResearcher) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCostInsights(period)
      .then((p) => {
        if (!cancelled) setPayload(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isResearcher, period]);

  return (
    <TeacherPage
      breadcrumb={
        <Link href="/teacher/classes" className="flex w-fit items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>
      }
      title="Cost"
      subtitle="Cross-class spend (researcher view)"
      actions={
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="sr-only">Period</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as SpendPeriod)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            {(Object.keys(PERIOD_LABEL) as SpendPeriod[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <InsightsTabs />

      {!isResearcher ? (
        <div role="alert" className="rounded border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          The cost overview is available to researchers only.
        </div>
      ) : error ? (
        <div role="alert" className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : loading && !payload ? (
        <div className="text-sm text-muted-foreground">Loading spend&hellip;</div>
      ) : payload ? (
        <div className="flex flex-col gap-6">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-semibold">{formatEur(payload.total_eur)}</span>
            <span className="text-sm text-muted-foreground">{PERIOD_LABEL[payload.period]}, all classes</span>
          </div>

          <SpendTable
            title="By cohort"
            headLabel="Cohort"
            rows={payload.by_cohort.map((c) => ({ label: c.cohort, eur: c.eur }))}
          />
          <SpendTable
            title="By model"
            headLabel="Model"
            rows={payload.by_model.map((m) => ({ label: m.model, eur: m.eur }))}
          />
          {payload.voice_eur > 0 ? (
            <SpendTable
              title="By voice (STT/TTS)"
              headLabel="Kind"
              rows={payload.by_voice_kind.map((v) => ({ label: v.kind.toUpperCase(), eur: v.eur }))}
            />
          ) : null}
          <SpendTable
            title="By class"
            headLabel="Class"
            rows={payload.per_class.map((c) => ({
              label: `${c.name} (${c.cohort})`,
              eur: c.eur,
            }))}
          />
        </div>
      ) : null}
    </TeacherPage>
  );
}

function SpendTable({
  title,
  headLabel,
  rows,
}: {
  title: string;
  headLabel: string;
  rows: { label: string; eur: number }[];
}) {
  return (
    <section aria-labelledby={`cost-${title}`} className="flex flex-col gap-2">
      <h2 id={`cost-${title}`} className="text-sm font-semibold">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No spend recorded for this period.</p>
      ) : (
        <table className="w-full max-w-md text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium">{headLabel}</th>
              <th className="py-1 text-right font-medium">EUR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border/50">
                <td className="py-1">{r.label}</td>
                <td className="py-1 text-right tabular-nums">{formatEur(r.eur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
