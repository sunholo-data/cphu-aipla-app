"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  WorkChart,
  WorkChecklist,
  WorkTableGrid,
  WorkWriting,
  chartHasPoints,
  tableRowsFromCells,
} from "@/components/shared/work/WorkViews";
import { plotFromCells } from "@/components/shared/work/chartPlot";
import { useLocaleMode, useT } from "@/i18n";
import {
  type ComparableActivity,
  type CompareGroup,
  type CompareKind,
  type CompareResult,
  fetchClassCompare,
  fetchComparableElements,
} from "@/lib/classCompareApi";
import { fittedSlope, slopeOutliers } from "@/lib/compareOutliers";
import { formatRelativeTime } from "@/lib/relativeTime";
import { resolveChartBinding } from "@/lib/resolveChartBinding";

/**
 * Compare one element across every group of a class (1.1.99 M1).
 *
 * Pick an activity of the class and one of its elements; see that element for
 * EVERY group at once — eight graphs side by side, eight tables — rendered by
 * the shared work miniatures (`components/shared/work/`), the same renderers
 * the transcript and "What they ended with" use, so a group's graph here is
 * the graph the group saw.
 *
 * Every group gets a card, including the ones with nothing yet. A failed read
 * is said out loud and never rendered as a grid of empty cards — "nothing yet"
 * and "could not read" are different answers. A refresh that fails after a good
 * read keeps the last data up and says how old it is.
 *
 * Refresh is a plain 30-second poll of the one class-scoped read (no new
 * realtime transport — that is M4). Teacher-only: this is not designed for a
 * projector (the doc's open question 2).
 */

export const COMPARE_POLL_MS = 30_000;

type Read =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ok"; result: CompareResult; at: number; stale: boolean };

function elementKey(kind: CompareKind, id: string): string {
  return `${kind}:${id}`;
}

export function ClassCompareView({ classId }: { classId: string }) {
  const t = useT("ClassComparePage");
  const mode = useLocaleMode();
  const locale = mode === "bilingual" ? "da" : mode;

  const [activities, setActivities] = useState<ComparableActivity[] | null>(null);
  const [pickerError, setPickerError] = useState(false);
  const [activityId, setActivityId] = useState("");
  const [element, setElement] = useState("");
  const [read, setRead] = useState<Read>({ kind: "idle" });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const selection = useRef("");

  useEffect(() => {
    let cancelled = false;
    fetchComparableElements(classId)
      .then((list) => {
        if (cancelled) return;
        setActivities(list);
        const first = list[0];
        if (first) {
          setActivityId(first.activityId);
          setElement(elementKey(first.elements[0].kind, first.elements[0].id));
        }
      })
      .catch(() => {
        if (!cancelled) setPickerError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const load = useCallback(
    async (background: boolean) => {
      if (!activityId || !element) return;
      const key = `${activityId}|${element}`;
      selection.current = key;
      const [kind, ...rest] = element.split(":");
      const elementId = rest.join(":");
      if (!background) setRead({ kind: "loading" });
      try {
        const result = await fetchClassCompare(classId, activityId, kind as CompareKind, elementId);
        if (selection.current !== key) return; // the teacher picked something else meanwhile
        const at = Date.now();
        setNow(at);
        setRead({ kind: "ok", result, at, stale: false });
      } catch {
        if (selection.current !== key) return;
        // A failed background refresh keeps the last good read up, marked stale;
        // a failed first read is an error, never an empty grid.
        setRead((prev) => (background && prev.kind === "ok" ? { ...prev, stale: true } : { kind: "error" }));
      }
    },
    [classId, activityId, element],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || !activityId || !element) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load(true);
    }, COMPARE_POLL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, load, activityId, element]);

  const activity = activities?.find((a) => a.activityId === activityId) ?? null;
  const kindLabel = (kind: CompareKind) =>
    ({ table: t("kindTable"), chart: t("kindChart"), writing: t("kindWriting"), checklist: t("kindChecklist") })[kind];

  if (pickerError) {
    return <p className="text-sm text-amber-800 dark:text-amber-300">{t("pickerError")}</p>;
  }
  if (activities === null) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }
  if (activities.length === 0) {
    return (
      <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
        {t("noActivities")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          {t("activityLabel")}
          <select
            className="min-w-[12rem] rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={activityId}
            onChange={(e) => {
              const next = activities.find((a) => a.activityId === e.target.value);
              setActivityId(e.target.value);
              if (next?.elements[0]) setElement(elementKey(next.elements[0].kind, next.elements[0].id));
            }}
          >
            {activities.map((a) => (
              <option key={a.activityId} value={a.activityId}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          {t("elementLabel")}
          <select
            className="min-w-[12rem] rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={element}
            onChange={(e) => setElement(e.target.value)}
          >
            {(activity?.elements ?? []).map((el) => (
              <option key={elementKey(el.kind, el.id)} value={elementKey(el.kind, el.id)}>
                {el.title ? `${kindLabel(el.kind)} — ${el.title}` : kindLabel(el.kind)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          {t("autoRefresh")}
        </label>
        {read.kind === "ok" ? (
          <span className="pb-1.5 text-xs text-muted-foreground" data-testid="compare-read-at">
            {t("readAt", { when: formatRelativeTime(read.at, now, locale) })}
          </span>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">{t("teacherOnly")}</p>

      <CompareBody read={read} locale={locale} onRetry={() => void load(false)} />
    </div>
  );
}

function CompareBody({
  read,
  locale,
  onRetry,
}: {
  read: Read;
  locale: "da" | "en";
  onRetry: () => void;
}) {
  const t = useT("ClassComparePage");

  const chartFit = useMemo(() => {
    if (read.kind !== "ok" || read.result.kind !== "chart") return null;
    const chart = read.result.elements.chart?.[0];
    const tables = read.result.elements.table ?? [];
    if (!chart || chart.chartKind === "bar") return null;
    const binding = resolveChartBinding(chart, tables);
    if (!binding) return null;
    const slopes: Record<string, number | null> = {};
    for (const g of read.result.groups) {
      slopes[g.groupCode] = g.data
        ? fittedSlope(plotFromCells(binding, g.data as Record<string, string>).points)
        : null;
    }
    return { slopes, ...slopeOutliers(slopes) };
  }, [read]);

  if (read.kind === "idle" || read.kind === "loading") {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }
  if (read.kind === "error") {
    return (
      <div className="flex items-center gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        <span>{t("readError")}</span>
        <button type="button" onClick={onRetry} className="rounded border border-border px-2 py-0.5 text-xs">
          {t("retry")}
        </button>
      </div>
    );
  }

  const { result } = read;
  const number = new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 });

  if (result.groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noGroups")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {read.stale ? (
        <p className="text-xs text-amber-800 dark:text-amber-300" role="status">
          {t("stale")}
        </p>
      ) : null}
      {chartFit && chartFit.outliers.size > 0 && chartFit.median !== null ? (
        <p className="text-xs text-muted-foreground">{t("outlierHint", { median: number.format(chartFit.median) })}</p>
      ) : null}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="compare-grid">
        {result.groups.map((g) => {
          const outlier = chartFit?.outliers.has(g.groupCode) ?? false;
          const slope = chartFit?.slopes[g.groupCode] ?? null;
          return (
            <li
              key={g.groupCode}
              data-testid="compare-card"
              data-group={g.groupCode}
              data-outlier={outlier ? "true" : "false"}
              className={`flex min-w-0 flex-col gap-2 rounded border bg-background p-3 ${
                outlier ? "border-amber-500 ring-1 ring-amber-500" : "border-border"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-1">
                <span className="font-mono text-sm font-semibold">{g.groupCode}</span>
                <span className="text-[11px] text-muted-foreground">
                  {g.updatedAt ? t("updated", { when: formatRelativeTime(g.updatedAt, Date.now(), locale) }) : null}
                </span>
              </div>
              {g.revoked ? <span className="w-fit rounded bg-muted px-1.5 text-[11px]">{t("revoked")}</span> : null}
              <Miniature result={result} group={g} />
              {slope !== null ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("slope", { slope: number.format(slope) })}
                  {outlier ? <strong className="ml-1 text-amber-800 dark:text-amber-300">{t("slopeOutlier")}</strong> : null}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Miniature({ result, group }: { result: CompareResult; group: CompareGroup }) {
  const t = useT("ClassComparePage");
  const nothing = <p className="text-xs italic text-muted-foreground">{t("nothingYet")}</p>;
  const data = group.data;
  if (!data) return nothing;
  const { elements } = result;

  if (result.kind === "table") {
    const table = elements.table?.[0];
    if (!table) return nothing;
    const rows = tableRowsFromCells(table, data as Record<string, string>);
    if (rows.length === 0) return nothing;
    return <WorkTableGrid title="" columns={table.columns} rows={rows} />;
  }
  if (result.kind === "chart") {
    const chart = elements.chart?.[0];
    const tables = elements.table ?? [];
    const cells = data as Record<string, string>;
    if (!chart || !chartHasPoints(chart, tables, cells)) return nothing;
    return <WorkChart title="" chart={chart} tables={tables} cells={cells} />;
  }
  if (result.kind === "writing") {
    const text = typeof data.text === "string" ? data.text : "";
    if (!text.trim()) return nothing;
    return (
      <div className="max-h-48 overflow-y-auto">
        <WorkWriting title="" text={text} />
      </div>
    );
  }
  const items = elements.checklist ?? [];
  const states = data as Record<string, { done?: boolean }>;
  const done = items.filter((i) => states[i.id]?.done).length;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-medium text-muted-foreground">{t("checklistCount", { done, total: items.length })}</p>
      <WorkChecklist items={items} isDone={(id) => Boolean(states[id]?.done)} />
    </div>
  );
}
