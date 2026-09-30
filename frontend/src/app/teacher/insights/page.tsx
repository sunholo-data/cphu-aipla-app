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
import { useT } from "@/i18n";


export default function TeacherInsightsPage() {
  const t = useT("TeacherInsightsPage");
  const [since, setSince] = useState<InsightsSince>("7d");
  // Researchers can switch between a cross-teacher comparison of EVERY class
  // (scope=all, 1.1.51) and their own. The toggle is hidden for
  // non-researchers; the backend independently 403s scope=all without the
  // claim.
  //
  // A researcher DEFAULTS to "all" (2026-09-11). It used to default to "own",
  // which for a researcher who teaches no class is an empty table with the
  // real data one un-noticed click away — while the cost tab next door
  // auto-scoped the same person to everything. `null` = no explicit choice
  // yet, so the default can resolve once the claim has loaded.
  const isResearcher = useIsResearcher();
  const [scopeChoice, setScopeChoice] = useState<InsightsScope | null>(null);
  const scope: InsightsScope = scopeChoice ?? "all";
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
          {t("dashboard")}
        </Link>
      }
      title={t("title")}
      subtitle={effectiveScope === "all" ? t("subtitleAll") : t("subtitle")}
      actions={
        <div className="flex items-center gap-2">
          {isResearcher ? <ScopeToggle value={scope} onChange={setScopeChoice} /> : null}
          <SinceSelect value={since} onChange={setSince} />
        </div>
      }
    >
      <InsightsTabs />

      <p className="text-xs text-muted-foreground" data-testid="window-label">
        {t.rich("window", { since: t(`since_${since}`), b: (chunks) => <strong>{chunks}</strong> })}
        {effectiveScope === "all" ? t("allTeachersSuffix") : null}
      </p>

      {error ? (
        <div role="alert" className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {isLoading && !payload ? (
        <div data-testid="loading" className="text-sm text-muted-foreground">
          {t("loading")}
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
  const t = useT("TeacherInsightsPage");
  return (
    <div
      role="group"
      aria-label={t("scopeLabel")}
      className="flex items-center rounded border border-border text-xs font-medium"
    >
      <button
        type="button"
        aria-pressed={value === "own"}
        onClick={() => onChange("own")}
        className={`rounded-l px-2.5 py-1 ${value === "own" ? "bg-accent" : "hover:bg-accent"}`}
      >
        {t("myClasses")}
      </button>
      <button
        type="button"
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
        className={`rounded-r px-2.5 py-1 ${value === "all" ? "bg-accent" : "hover:bg-accent"}`}
      >
        {t("allTeachers")}
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
  const t = useT("TeacherInsightsPage");
  return (
    <label className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground">
      <span className="sr-only">{t("timeWindow")}</span>
      <select
        aria-label={t("timeWindow")}
        value={value}
        onChange={(e) => onChange(e.target.value as InsightsSince)}
        className="cursor-pointer appearance-none bg-transparent text-xs focus:outline-none"
      >
        <option value="7d">{t("opt_7d")}</option>
        <option value="30d">{t("opt_30d")}</option>
        <option value="all">{t("opt_all")}</option>
      </select>
    </label>
  );
}
