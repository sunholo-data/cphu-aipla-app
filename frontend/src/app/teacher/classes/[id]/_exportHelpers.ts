/**
 * Class-detail export helpers — extracted from `page.tsx` so the
 * page stays under the 800-line soft cap. Pure logic: HTTP fetch
 * orchestration + CSV row construction + the export controller used
 * by the page's "CSV" / "JSON" buttons. No JSX.
 *
 * Sprint ANALYTICS-CHAT-AND-INSIGHTS follow-up — split landed after
 * M9 wiring nudged the file from 816 → 819.
 */

import { downloadCsv, downloadJson, slugify } from "@/lib/download";
import {
  type ClassPayload,
  type SessionRow,
  type SessionSummaryPayload,
  fetchGroupLatestReport,
  listClassRecentSessions,
} from "@/lib/teacherApi";

/** Cap on per-export parallel report fetches. Matches the
 *  recent-sessions route's page_size cap (le=100), sized for a Danish
 *  class of ~60 students with headroom for repeat sessions. */
export const EXPORT_SESSION_LIMIT = 100;

/** One row in the per-session bundle: either the full report, or an
 *  error sentinel for sessions that couldn't be fetched. */
export type SessionBundle =
  | { row: SessionRow; report: SessionSummaryPayload; error: null }
  | { row: SessionRow; report: null; error: string };

/** Fetch the full per-session reports for every row in `sessions`,
 *  in parallel. Sessions without a groupCode are skipped — the report
 *  endpoint is keyed by group code and synthetic/test rows without one
 *  have nothing useful to export. Per-session failures are captured as
 *  error entries rather than aborting the export. */
export async function fetchSessionBundles(
  classId: string,
): Promise<{ sessions: SessionRow[]; bundles: SessionBundle[] }> {
  const sessions = await listClassRecentSessions(classId, EXPORT_SESSION_LIMIT);
  const bundles = await Promise.all(
    sessions.map(async (row): Promise<SessionBundle> => {
      if (!row.groupCode) {
        return { row, report: null, error: "no group code on this session" };
      }
      try {
        const report = await fetchGroupLatestReport(row.groupCode, row.sessionId);
        return { row, report, error: null };
      } catch (err) {
        return {
          row,
          report: null,
          error: err instanceof Error ? err.message : "fetch failed",
        };
      }
    }),
  );
  return { sessions, bundles };
}

/** CSV in long format: one row per chat turn across every session in the
 *  class. Session metadata is repeated on every row so teachers can pivot
 *  in Excel without joining tables. Failed sessions appear as a single
 *  row with the error in the `content` column. */
export function bundlesToCsvRows(
  bundles: SessionBundle[],
  skillNameById: Map<string, string>,
): ReadonlyArray<ReadonlyArray<unknown>> {
  const header = [
    "groupCode",
    "sessionId",
    "activityId",
    "activityName",
    "sessionTitle",
    "startedAt",
    "turnIndex",
    "turnTimestamp",
    "role",
    "content",
  ];
  const rows: unknown[][] = [header];
  for (const b of bundles) {
    const activityName = skillNameById.get(b.row.skillId) ?? "";
    if (b.error || !b.report) {
      rows.push([
        b.row.groupCode ?? "",
        b.row.sessionId,
        b.row.skillId,
        activityName,
        b.row.title ?? "",
        "",
        "",
        "",
        "error",
        b.error ?? "no report",
      ]);
      continue;
    }
    const startedAt = b.report.startedAt;
    b.report.conversation.forEach((t, i) => {
      rows.push([
        b.report!.groupCode ?? "",
        b.report!.sessionId,
        b.report!.activityId,
        activityName,
        b.row.title ?? "",
        startedAt,
        i,
        t.timestamp,
        t.role,
        t.content,
      ]);
    });
  }
  return rows;
}

/** Export the class's full session data as CSV or JSON. Fetches every
 *  session's transcript in parallel; tolerates per-session failures. */
export async function handleExportSessions(
  cls: ClassPayload | null,
  skillNameById: Map<string, string>,
  format: "csv" | "json",
): Promise<void> {
  if (!cls) return;
  const today = new Date().toISOString().slice(0, 10);
  const stem = `class-${slugify(cls.name)}-${today}`;
  const { sessions, bundles } = await fetchSessionBundles(cls.classId);
  if (sessions.length === 0) return;
  if (format === "csv") {
    downloadCsv(`${stem}.csv`, bundlesToCsvRows(bundles, skillNameById));
    return;
  }
  downloadJson(`${stem}.json`, {
    classId: cls.classId,
    className: cls.name,
    exportedAt: new Date().toISOString(),
    sessionCount: sessions.length,
    sessions: bundles.map((b) => ({
      ...b.row,
      activityName: skillNameById.get(b.row.skillId) ?? null,
      report: b.report,
      error: b.error,
    })),
  });
}
