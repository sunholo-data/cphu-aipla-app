"use client";

import { useEffect, useState } from "react";

import {
  type ActivitySpend,
  type ClassSpendPayload,
  type DaySpend,
  type SpendPeriod,
  fetchClassSpend,
  formatEur,
  usedVoice,
} from "@/lib/costApi";
import { useLocaleMode, useT, type MessageKey } from "@/i18n";

const PERIODS: { value: SpendPeriod; label: MessageKey<"BudgetPanel"> }[] = [
  { value: "this_month", label: "thisMonth" },
  { value: "last_month", label: "lastMonth" },
  { value: "all_time", label: "allTime" },
];

/**
 * Per-class spend panel for the class-detail screen (sprint 1.1.9).
 *
 * Shows this-period spend, a month-end projection (this_month only), the
 * cost of each lesson day, and the top activities / groups by cost. No cap
 * progress bar — class-level caps are deferred (the shipped enforcer is
 * skill-level). EUR only.
 */
export function BudgetPanel({ classId }: { classId: string }) {
  const t = useT("BudgetPanel");
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
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailedFallback"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `t` is stable per locale; a language switch need not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, period]);

  return (
    <section aria-labelledby="budget-panel-label" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="budget-panel-label" className="text-sm font-semibold">
          {t("spend")}
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="sr-only">{t("period")}</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as SpendPeriod)}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {t(p.label)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("loadFailed", { error })}
        </p>
      ) : data ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-2xl font-semibold">{formatEur(data.total_eur)}</span>
            {data.projected_eur !== null ? (
              <span className="text-sm text-muted-foreground">
                {t("projected", { amount: formatEur(data.projected_eur) })}
              </span>
            ) : null}
          </div>

          {usedVoice(data) ? (
            <p className="text-xs text-muted-foreground" data-testid="voice-cost-line">
              {t("voice", { amount: formatEur(data.voice_eur) })}
              {data.by_voice_kind.length > 0
                ? ` (${data.by_voice_kind
                    .map((v) => `${v.kind.toUpperCase()} ${formatEur(v.eur)}`)
                    .join(" · ")})`
                : null}
            </p>
          ) : null}

          {data.total_eur === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSpend")}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <DayList days={data.by_day ?? []} />
              <SpendList
                title={t("topActivities")}
                rows={data.by_activity.slice(0, 3).map((a) => ({ label: activityLabel(a), eur: a.eur }))}
              />
              <SpendList
                title={t("topGroups")}
                rows={data.by_group.slice(0, 3).map((g) => ({ label: g.group_id, eur: g.eur }))}
              />
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function activityLabel(a: ActivitySpend): string {
  return a.title || a.activity_id || a.skill_id;
}

/** One row per lesson day, newest first — "what did Tuesday cost?" without
 *  leaving the class page. Scrolls rather than truncating: an all-time view
 *  of a busy class is still one list. */
function DayList({ days }: { days: DaySpend[] }) {
  const t = useT("BudgetPanel");
  const mode = useLocaleMode();
  if (days.length === 0) return null;
  const fmt = new Intl.DateTimeFormat(mode === "en" ? "en-GB" : "da-DK", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return (
    <div className="flex flex-col gap-1 sm:col-span-2" data-testid="spend-by-day">
      <h4 className="text-xs font-medium text-muted-foreground">{t("byDay")}</h4>
      <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto text-sm">
        {days.map((d) => {
          const [y, m, day] = d.day.split("-").map(Number);
          return (
            <li key={d.day} className="flex items-center justify-between gap-2">
              <span className="truncate">
                <time dateTime={d.day}>{fmt.format(new Date(y, m - 1, day))}</time>
                <span className="ml-2 text-xs text-muted-foreground">
                  {t("dayDetail", { replies: d.replies, groups: d.groups })}
                </span>
              </span>
              <span className="tabular-nums text-muted-foreground">{formatEur(d.eur)}</span>
            </li>
          );
        })}
      </ul>
    </div>
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
