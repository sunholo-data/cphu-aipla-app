/**
 * /teacher/insights — cross-class comparison page (1.M, sprint M8).
 *
 * Fetches `/api/insights/compare` and renders the rows in a sortable
 * table. Per the design doc, this surface answers "how does each
 * class compare to my others?" — engagement at a glance, with deep
 * links into per-class pages.
 *
 * Sibling surfaces (M9):
 * - /teacher/classes — KPI strip on each class card
 * - /teacher/classes/[id] — ClassInsightsPanel above Recent activity
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, BarChart3 } from "lucide-react";

import { CrossClassTable } from "@/components/teacher/insights/CrossClassTable";
import {
  fetchInsightsCompare,
  type InsightsComparePayload,
  type InsightsSince,
} from "@/lib/insightsApi";

const SINCE_LABEL: Record<InsightsSince, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

export default function TeacherInsightsPage() {
  const [since, setSince] = useState<InsightsSince>("7d");
  const [payload, setPayload] = useState<InsightsComparePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchInsightsCompare(since)
      .then((p) => {
        if (cancelled) return;
        setPayload(p);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [since]);

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/teacher/classes" className="flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">Insights</span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="text-xl font-semibold sm:text-2xl">Cross-class insights</h1>
        </div>
        <SinceSelect value={since} onChange={setSince} />
      </header>

      <p className="text-xs text-muted-foreground" data-testid="window-label">
        Window: <strong>{SINCE_LABEL[since]}</strong>
      </p>

      {error ? (
        <div role="alert" className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {isLoading && !payload ? (
        <div data-testid="loading" className="text-sm text-muted-foreground">
          Loading classes…
        </div>
      ) : null}

      {payload ? <CrossClassTable rows={payload.rows} /> : null}
    </div>
  );
}

function SinceSelect({
  value,
  onChange,
}: {
  value: InsightsSince;
  onChange: (v: InsightsSince) => void;
}) {
  return (
    <label className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground">
      <span className="sr-only">Time window</span>
      <select
        aria-label="Time window"
        value={value}
        onChange={(e) => onChange(e.target.value as InsightsSince)}
        className="cursor-pointer appearance-none bg-transparent text-xs focus:outline-none"
      >
        <option value="7d">7 days</option>
        <option value="30d">30 days</option>
        <option value="all">All time</option>
      </select>
    </label>
  );
}
