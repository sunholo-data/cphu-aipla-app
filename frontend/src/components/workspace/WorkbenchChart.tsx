"use client";

import { useEffect, useMemo, useState } from "react";

import { TABLE_CHANGE_EVENT, tableStorageKey, type TableElementDef } from "./WorkbenchTable";
import { useT } from "@/i18n";
import type { ChartElement } from "@/lib/elementTypes";

import { resolveChartBinding, type ResolvedChartBinding } from "@/lib/resolveChartBinding";
import { ChartSvg } from "@/components/shared/work/ChartSvg";
import { plotFromCells, type Plotted } from "@/components/shared/work/chartPlot";

/** Canonical ChartElement re-exported under the render-side name. */
export type ChartElementDef = ChartElement;

interface WorkbenchChartProps {
  skillId: string;
  charts: ChartElementDef[];
  /** The activity's data tables — the chart auto-binds to the first one and
   *  plots its first two numeric columns. */
  tables: TableElementDef[];
}

function readPlot(skillId: string, binding: ResolvedChartBinding): Plotted {
  let values: Record<string, string> = {};
  if (typeof window !== "undefined") {
    try {
      values = JSON.parse(window.sessionStorage.getItem(tableStorageKey(skillId)) || "{}");
    } catch {
      values = {};
    }
  }
  return plotFromCells(binding, values);
}

/**
 * WorkbenchChart — deterministic SVG chart of the student's data table (1.1.38
 * M2). Auto-binds to the activity's table and plots its first two numeric
 * columns (x, y). Re-reads on the `aipla:table-change` event the table fires on
 * each commit, so the plot grows as the student enters readings. Zero LLM.
 */
export function WorkbenchChart({ skillId, charts, tables }: WorkbenchChartProps) {
  const t = useT("WorkbenchChart");
  const [tick, setTick] = useState(0);
  const hasTable = tables.length > 0;

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ skillId?: string }>).detail;
      if (!detail || detail.skillId === skillId) setTick((t) => t + 1);
    };
    window.addEventListener(TABLE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(TABLE_CHANGE_EVENT, onChange);
  }, [skillId]);

  // 1.1.64 — resolved PER CHART, so several charts can plot different variable
  // pairs off the same table. Previously one shared plot was computed from
  // tables[0] and handed to every chart, which made "more than one chart" the
  // same graph drawn several ways.
  const resolved = useMemo(
    () => charts.map((chart) => ({ chart, binding: resolveChartBinding(chart, tables) })),
    [charts, tables],
  );
  const plots = useMemo(
    () => resolved.map(({ binding }) => (binding ? readPlot(skillId, binding) : null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved, skillId, tick],
  );

  return (
    <div className="space-y-4 p-4">
      {resolved.map(({ chart, binding }, i) => (
        <section
          key={chart.id}
          className="rounded-lg border border-border bg-card p-4 text-sm"
          aria-label={chart.title || t("untitled")}
        >
          {chart.title && (
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {chart.title}
            </h3>
          )}
          {binding?.note && (
            <p className="mb-2 rounded border border-amber-200 bg-amber-50/60 px-2 py-1 text-[10px] text-amber-900">
              {t(`note_${binding.note}`)}
            </p>
          )}
          {plots[i] && plots[i]!.points.length > 0 ? (
            <ChartSvg kind={chart.chartKind} plot={plots[i]!} />
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {hasTable ? t("fillTable") : t("needsTable")}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
