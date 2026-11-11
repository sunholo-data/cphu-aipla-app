/**
 * /teacher/insights/classes — "Alle klasser": every class side by side (1.M
 * M8; moved here from `/teacher/insights` in the UI sweep, 2026-11-11).
 *
 * The ONE home of the cross-class table. It used to render twice: here (as
 * "Overview", without spend) and inside an opt-in "insights & spend" panel on
 * the class list (with a spend column and four totals). The class list now
 * links here, and this page carries what the panel had:
 *   - the sortable `CrossClassTable` WITH the spend column (this month),
 *   - the four totals (active groups, messages in the window, spend this month,
 *     last activity),
 *   - the window (7 d / 30 d / all) — in the URL as `?since=`,
 *   - for a researcher, "Dine klasser | Alle læreres klasser" — `?scope=`.
 *
 * Spend per class: the caller's own classes come from `/insights/cost/mine`;
 * a researcher's all-teachers view uses the cross-class cost overview, which is
 * also why Omkostninger no longer needs its own "per class" table. Spend has
 * its own period (this month / last month / all time, `?spend=`) because the
 * billing periods are calendar months, not the 7 d / 30 d engagement window —
 * and so the Cost page's per-class figures for every period survive here.
 *
 * Each read fails on its own and says so with Retry (`LoadError`) — a failed
 * read must never render as "no engagement".
 */

"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { CrossClassTable } from "@/components/teacher/insights/CrossClassTable";
import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";
import { ScopeToggle } from "@/components/teacher/insights/ScopeToggle";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { LoadError } from "@/components/ui/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import { useUrlTab } from "@/hooks/useUrlTab";
import { useLocaleMode, useT } from "@/i18n";
import { type SpendPeriod, fetchCostInsights, fetchTeacherSpend, formatEur } from "@/lib/costApi";
import {
  type InsightsComparePayload,
  type InsightsScope,
  type InsightsSince,
  type InsightsSummaryPayload,
  fetchInsightsCompare,
  fetchInsightsSummary,
} from "@/lib/insightsApi";
import { formatRelativeTime } from "@/lib/relativeTime";

const SINCE: readonly InsightsSince[] = ["7d", "30d", "all"];
const SCOPES: readonly InsightsScope[] = ["own", "all"];
const SPEND_PERIODS: readonly SpendPeriod[] = ["this_month", "last_month", "all_time"];

type Load<T> = { kind: "loading" } | { kind: "ok"; value: T } | { kind: "error" };

interface Spend {
  total: number;
  byClass: Map<string, number>;
}

export default function InsightsAllClassesPage() {
  return (
    <Suspense fallback={null}>
      <AllClassesInner />
    </Suspense>
  );
}

/** Run `fetcher` whenever `key` or `reload` change; keep the three states apart. */
function useLoad<T>(fetcher: () => Promise<T>, key: string, reload: number): Load<T> {
  const [state, setState] = useState<Load<T>>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetcher()
      .then((value) => {
        if (!cancelled) setState({ kind: "ok", value });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
    // `key` stands in for the fetcher's inputs; the fetcher itself is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload]);
  return state;
}

function AllClassesInner() {
  const t = useT("TeacherInsightsPage");
  const localeMode = useLocaleMode();
  const timeLocale = localeMode === "bilingual" ? "da" : localeMode;
  const isResearcher = useIsResearcher();
  // 30 days by default: a 7-day window on a quiet week read as "no data"
  // (the same choice the class list's panel made on 2026-09-11).
  const [since, setSince] = useUrlTab<InsightsSince>("since", SINCE, "30d");
  // A researcher DEFAULTS to every teacher's classes (2026-09-11): a researcher
  // who teaches no class otherwise lands on an empty table with the data one
  // un-noticed click away. Non-researchers are always "own"; the backend 403s
  // scope=all without the claim either way.
  const [scopeChoice, setScope] = useUrlTab<InsightsScope>("scope", SCOPES, isResearcher ? "all" : "own");
  const scope: InsightsScope = isResearcher ? scopeChoice : "own";
  const [spendPeriod, setSpendPeriod] = useUrlTab<SpendPeriod>("spend", SPEND_PERIODS, "this_month");

  const [reloadTable, setReloadTable] = useState(0);
  const [reloadTotals, setReloadTotals] = useState(0);
  const [reloadSpend, setReloadSpend] = useState(0);

  const compare = useLoad<InsightsComparePayload>(
    () => fetchInsightsCompare(since, undefined, scope),
    `${since}|${scope}`,
    reloadTable,
  );
  const summary = useLoad<InsightsSummaryPayload>(
    () => fetchInsightsSummary(since, undefined, scope),
    `${since}|${scope}`,
    reloadTotals,
  );
  const spend = useLoad<Spend>(
    async () => {
      if (scope === "all") {
        const p = await fetchCostInsights(spendPeriod);
        return { total: p.total_eur, byClass: new Map(p.per_class.map((c) => [c.class_id, c.eur])) };
      }
      const p = await fetchTeacherSpend(spendPeriod);
      return { total: p.total_eur, byClass: new Map(p.per_class.map((c) => [c.class_id, c.eur])) };
    },
    `${scope}|${spendPeriod}`,
    reloadSpend,
  );

  const totals = useMemo(() => {
    if (summary.kind !== "ok") return null;
    const vals = summary.value.classes;
    return {
      activeGroups: vals.reduce((s, v) => s + (v.activeGroups || 0), 0),
      totalMessages: vals.reduce((s, v) => s + (v.totalMessages || 0), 0),
      lastActivity: vals.reduce<string | null>(
        (acc, v) => (v.lastActivity && (!acc || v.lastActivity > acc) ? v.lastActivity : acc),
        null,
      ),
    };
  }, [summary]);

  const retryTotals = useCallback(() => {
    setReloadTotals((n) => n + 1);
  }, []);

  const spendValue =
    spend.kind === "ok" ? formatEur(spend.value.total) : spend.kind === "loading" ? "…" : "—";

  return (
    <TeacherPage
      breadcrumb={
        <Link href="/teacher/classes" className="flex w-fit items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("classesCrumb")}
        </Link>
      }
      title={t("title")}
      subtitle={scope === "all" ? t("subtitleAll") : t("subtitle")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {isResearcher ? <ScopeToggle value={scopeChoice} onChange={setScope} /> : null}
          <SinceSelect value={since} onChange={setSince} />
          <SpendSelect value={spendPeriod} onChange={setSpendPeriod} />
        </div>
      }
    >
      <InsightsTabs />

      <p className="text-xs text-muted-foreground" data-testid="window-label">
        {t.rich("window", { since: t(`since_${since}`), b: (chunks) => <strong>{chunks}</strong> })}
        {scope === "all" ? t("allTeachersSuffix") : null}
      </p>

      <section aria-label={t("totalsLabel")} className="flex flex-col gap-2">
        {summary.kind === "error" ? (
          <LoadError what={t("whatTotals")} onRetry={retryTotals} />
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="insights-totals">
            <Stat label={t("activeGroups")} value={totals ? String(totals.activeGroups) : "…"} />
            <Stat
              label={t("messagesIn", { window: t(`opt_${since}`).toLowerCase() })}
              value={totals ? String(totals.totalMessages) : "…"}
            />
            <Stat label={t(`spend_${spendPeriod}`)} value={spendValue} />
            <Stat
              label={t("lastActivity")}
              value={
                !totals
                  ? "…"
                  : totals.lastActivity
                    ? formatRelativeTime(totals.lastActivity, Date.now(), timeLocale)
                    : t("none")
              }
            />
          </dl>
        )}
        {spend.kind === "error" ? (
          <LoadError what={t("whatSpend")} onRetry={() => setReloadSpend((n) => n + 1)} />
        ) : null}
      </section>

      {compare.kind === "error" ? (
        <LoadError what={t("whatClasses")} onRetry={() => setReloadTable((n) => n + 1)} />
      ) : compare.kind === "loading" ? (
        <div role="status" aria-label={t("loading")} data-testid="loading" className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <CrossClassTable
          rows={compare.value.rows}
          since={since}
          spendPeriod={spendPeriod}
          spendByClassId={spend.kind === "ok" ? spend.value.byClass : undefined}
        />
      )}
    </TeacherPage>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function SpendSelect({ value, onChange }: { value: SpendPeriod; onChange: (v: SpendPeriod) => void }) {
  const t = useT("TeacherInsightsPage");
  return (
    <label className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
      <span className="text-muted-foreground">{t("spendPeriod")}</span>
      <select
        aria-label={t("spendPeriodLabel")}
        value={value}
        onChange={(e) => onChange(e.target.value as SpendPeriod)}
        className="cursor-pointer appearance-none bg-transparent text-xs focus:outline-none"
      >
        {SPEND_PERIODS.map((p) => (
          <option key={p} value={p}>
            {t(`spendOpt_${p}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SinceSelect({ value, onChange }: { value: InsightsSince; onChange: (v: InsightsSince) => void }) {
  const t = useT("TeacherInsightsPage");
  return (
    // The ring sits on the label: the select itself is unstyled, and its
    // `focus:outline-none` left keyboard focus invisible (UI sweep 2026-11-11).
    <label className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
      <span className="sr-only">{t("timeWindow")}</span>
      <select
        aria-label={t("timeWindow")}
        value={value}
        onChange={(e) => onChange(e.target.value as InsightsSince)}
        className="cursor-pointer appearance-none bg-transparent text-xs focus:outline-none"
      >
        {SINCE.map((w) => (
          <option key={w} value={w}>
            {t(`opt_${w}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
