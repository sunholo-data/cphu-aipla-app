"use client";

import { type ReactNode, useEffect, useState } from "react";

import {
  type ActivityPayload,
  type GroupFinalWork,
  fetchActivity,
  fetchGroupFinalWork,
} from "@/lib/teacherApi";
import {
  WorkChart,
  WorkChecklist,
  WorkTableGrid,
  WorkWriting,
  chartHasPoints,
  tableRowsFromCells,
} from "@/components/shared/work/WorkViews";
import { useT } from "@/i18n";

/**
 * "What they ended with" (1.1.136 M2) — a group's FINAL work on an activity,
 * beside the timeline that shows how they got there.
 *
 * Project-lead meeting, 29 Sep: student evaluations should include the actual
 * figures and data they create, contextually linked to the chat. The timeline
 * (M1) is the "contextually linked" half; this is the figures-and-data half.
 *
 * Read from the per-group stores (`table_progress`, `writing_progress`,
 * `checklist_progress`, `concept_progress`) through the same dual-audience GETs
 * the student workspace uses — authorised for teachers and researchers by
 * `protocols/progress_read_access.py` (M3). The element definitions (titles,
 * columns, units, the chart's binding) come from the activity itself, so the
 * chart is re-rendered with the activity's own chart definition through the
 * same `ChartSvg` the student saw.
 *
 * Empty elements are omitted; an activity with no workbench elements renders
 * nothing. Photos are never shown — they are not kept (policy), and the panel
 * says so rather than leaving a teacher to wonder where they went.
 *
 * ⚠️ The stores hold the CURRENT state per group+activity, across sessions —
 * not "at the end of this session". The hint says so.
 */

type Load =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ok"; activity: ActivityPayload; work: GroupFinalWork };

export interface FinalWorkPanelProps {
  activityId: string;
  groupCode: string;
  /** Narrows the read to this class (class owner or researcher). */
  classId?: string | null;
  /** Change it to re-read (the report's live poll); the last data stays up meanwhile. */
  refreshKey?: string | number;
}

function hasWorkbench(a: ActivityPayload): boolean {
  return Boolean(
    a.table?.length || a.chart?.length || a.writing?.length || a.checklist?.length || a.conceptMap?.length || a.solution?.length,
  );
}

export function FinalWorkPanel({ activityId, groupCode, classId, refreshKey }: FinalWorkPanelProps) {
  const t = useT("FinalWorkPanel");
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let activity: ActivityPayload | null = null;
      try {
        activity = await fetchActivity(activityId);
      } catch {
        activity = null;
      }
      // No definitions (a legacy skill-keyed activity, or one this reader cannot
      // open) → nothing to label the work with; no elements → nothing to show.
      if (!activity || !hasWorkbench(activity)) {
        if (!cancelled) setLoad({ kind: "none" });
        return;
      }
      const work = await fetchGroupFinalWork(activityId, groupCode, classId);
      if (!cancelled) setLoad({ kind: "ok", activity, work });
    })();
    return () => {
      cancelled = true;
    };
  }, [activityId, groupCode, classId, refreshKey]);

  if (load.kind === "none") return null;

  const shell = (body: ReactNode) => (
    <section aria-labelledby="final-work-label" className="flex flex-col gap-2" data-testid="final-work-panel">
      <div className="flex flex-col gap-0.5">
        <h2 id="final-work-label" className="text-base font-semibold">
          {t("heading")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
      </div>
      <div className="flex flex-col gap-4 rounded border border-border bg-background p-3">{body}</div>
    </section>
  );

  if (load.kind === "loading") {
    return shell(<p className="text-xs text-muted-foreground">{t("loading")}</p>);
  }

  const { activity, work } = load;
  const tables = activity.table ?? [];
  const cells = work.cells ?? {};
  const docs = work.docs ?? {};
  const itemStates = work.itemStates ?? {};
  const nodeStates = work.nodeStates ?? {};

  const filledTables = tables
    .map((tbl) => ({ tbl, rows: tableRowsFromCells(tbl, cells) }))
    .filter(({ rows }) => rows.length > 0);
  const drawnCharts = (activity.chart ?? []).filter((c) => chartHasPoints(c, tables, cells));
  const writings = (activity.writing ?? []).filter((w) => (docs[w.id]?.text ?? "").trim() !== "");
  const checklist = activity.checklist ?? [];
  const ticked = checklist.filter((i) => itemStates[i.id]?.done);
  const conceptNodes = (activity.conceptMap ?? []).flatMap((m) => m.nodes ?? []);
  const shownNodes = conceptNodes.filter((n) => {
    const s = nodeStates[n.id]?.status;
    return s === "partial" || s === "demonstrated";
  });
  const hasPhotos = (activity.solution?.length ?? 0) > 0;

  const unreadable = [work.cells, work.docs, work.itemStates, work.nodeStates].filter((v) => v === null).length;
  const nothing =
    filledTables.length === 0 &&
    drawnCharts.length === 0 &&
    writings.length === 0 &&
    ticked.length === 0 &&
    shownNodes.length === 0;

  return shell(
    <>
      {unreadable === 4 ? (
        <p className="text-xs text-amber-800 dark:text-amber-300">{t("unreadable")}</p>
      ) : unreadable > 0 ? (
        <p className="text-xs text-amber-800 dark:text-amber-300">{t("partlyUnreadable")}</p>
      ) : null}

      {nothing && unreadable < 4 ? <p className="text-xs text-muted-foreground">{t("nothingYet")}</p> : null}

      {filledTables.map(({ tbl, rows }) => (
        <WorkTableGrid key={tbl.id} title={tbl.title || t("untitledTable")} columns={tbl.columns} rows={rows} />
      ))}

      {drawnCharts.map((chart) => (
        <WorkChart key={chart.id} title={chart.title || t("untitledChart")} chart={chart} tables={tables} cells={cells} />
      ))}

      {writings.map((w) => (
        <WorkWriting key={w.id} title={w.title || w.prompt || t("untitledWriting")} text={docs[w.id]!.text} />
      ))}

      {ticked.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">
            {t("checklist", { done: ticked.length, total: checklist.length })}
          </p>
          <WorkChecklist
            items={checklist.map((i) => ({
              id: i.id,
              label: itemStates[i.id]?.done && itemStates[i.id]?.by === "ai" ? `${i.label} ${t("byTutor")}` : i.label,
            }))}
            isDone={(id) => Boolean(itemStates[id]?.done)}
          />
        </div>
      ) : null}

      {shownNodes.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">{t("concepts")}</p>
          <ul className="flex flex-col gap-0.5 text-xs">
            {shownNodes.map((n) => (
              <li key={n.id}>
                {n.label} —{" "}
                <span className="text-muted-foreground">
                  {nodeStates[n.id]?.status === "demonstrated" ? t("statusDemonstrated") : t("statusPartial")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasPhotos ? <p className="text-xs italic text-muted-foreground">{t("photosNotKept")}</p> : null}
    </>,
  );
}
