"use client";

import { useEffect, useState } from "react";

import {
  type ClassSpendPayload,
  type SpendPeriod,
  fetchClassSpend,
  formatEur,
} from "@/lib/costApi";

const PERIODS: { value: SpendPeriod; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "all_time", label: "All time" },
];

/**
 * Per-class spend panel for the class-detail screen (sprint 1.1.9).
 *
 * Shows this-period spend, a month-end projection (this_month only), and
 * the top activities / groups by cost. No cap progress bar — class-level
 * caps are deferred (the shipped enforcer is skill-level). EUR only.
 */
export function BudgetPanel({ classId }: { classId: string }) {
  const [period, setPeriod] = useState<SpendPeriod>("this_month");
  const [data, setData] = useState<ClassSpendPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchClassSpend(classId, period)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load spend");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, period]);

  return (
    <section aria-labelledby="budget-panel-label" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="budget-panel-label" className="text-sm font-semibold">
          Spend
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="sr-only">Period</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as SpendPeriod)}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading spend&hellip;</p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&rsquo;t load spend: {error}
        </p>
      ) : data ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-2xl font-semibold">{formatEur(data.total_eur)}</span>
            {data.projected_eur !== null ? (
              <span className="text-sm text-muted-foreground">
                projected {formatEur(data.projected_eur)} at current usage rate
              </span>
            ) : null}
          </div>

          {data.total_eur === 0 ? (
            <p className="text-sm text-muted-foreground">No spend recorded for this period.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <SpendList
                title="Top activities"
                rows={data.by_activity.slice(0, 3).map((a) => ({ label: a.skill_id, eur: a.eur }))}
              />
              <SpendList
                title="Top groups"
                rows={data.by_group.slice(0, 3).map((g) => ({ label: g.group_id, eur: g.eur }))}
              />
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SpendList({ title, rows }: { title: string; rows: { label: string; eur: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <ul className="flex flex-col gap-0.5 text-sm">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-2">
            <span className="truncate">{r.label}</span>
            <span className="tabular-nums text-muted-foreground">{formatEur(r.eur)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
