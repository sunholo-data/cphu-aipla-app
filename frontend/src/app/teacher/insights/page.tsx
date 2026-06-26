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
import { ArrowLeft } from "lucide-react";

import { CrossClassTable } from "@/components/teacher/insights/CrossClassTable";
import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import {
  fetchInsightsCompare,
  type InsightsComparePayload,
  type InsightsScope,
  type InsightsSince,
} from "@/lib/insightsApi";

const SINCE_LABEL: Record<InsightsSince, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

export default function TeacherInsightsPage() {
  const [since, setSince] = useState<InsightsSince>("7d");
  // Researchers can switch to a cross-teacher comparison of EVERY class
  // (scope=all, 1.1.51). The toggle is hidden for non-researchers; the
  // backend independently 403s scope=all without the claim.
  const isResearcher = useIsResearcher();
  const [scope, setScope] = useState<InsightsScope>("own");
  const effectiveScope: InsightsScope = isResearcher ? scope : "own";
  const [payload, setPayload] = useState<InsightsComparePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchInsightsCompare(since, undefined, effectiveScope)
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
  }, [since, effectiveScope]);

  return (
    <TeacherPage
      breadcrumb={
        <Link
          href="/teacher/classes"
          className="flex w-fit items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>
      }
      title="Insights"
      subtitle={effectiveScope === "all" ? "Cross-class comparison · all teachers" : "Cross-class comparison"}
      actions={
        <div className="flex items-center gap-2">
          {isResearcher ? <ScopeToggle value={scope} onChange={setScope} /> : null}
          <SinceSelect value={since} onChange={setSince} />
        </div>
      }
    >
      <InsightsTabs />

      <p className="text-xs text-muted-foreground" data-testid="window-label">
        Window: <strong>{SINCE_LABEL[since]}</strong>
        {effectiveScope === "all" ? " · all teachers" : null}
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
    </TeacherPage>
  );
}

function ScopeToggle({
  value,
  onChange,
}: {
  value: InsightsScope;
  onChange: (v: InsightsScope) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Class scope"
      className="flex items-center rounded border border-border text-xs font-medium"
    >
      <button
        type="button"
        aria-pressed={value === "own"}
        onClick={() => onChange("own")}
        className={`rounded-l px-2.5 py-1 ${value === "own" ? "bg-accent" : "hover:bg-accent"}`}
      >
        My classes
      </button>
      <button
        type="button"
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
        className={`rounded-r px-2.5 py-1 ${value === "all" ? "bg-accent" : "hover:bg-accent"}`}
      >
        All teachers
      </button>
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
