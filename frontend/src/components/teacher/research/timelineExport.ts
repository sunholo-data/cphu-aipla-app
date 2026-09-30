/**
 * 1.1.136 §Exports — the review timeline (turns AND work, in time order) as
 * spreadsheet rows. Pure: no fetch, no DOM, so the exact rows are testable.
 *
 * Column contract (group-report CSV):
 *
 *   timestamp, role, content, kind, label
 *
 * The first three are the columns the chat-only CSV has always had, in the same
 * positions and under the same names, so a sheet or script that read the old
 * file still finds them. `kind` (`turn` | `work`) and `label` are appended.
 * Work rows leave `role` empty and put a compact, human summary of the element's
 * state in `content` — the same text the expanded card shows, never raw JSON.
 * The raw snapshot is in the JSON export only.
 */

import type { ChatLogTimeline, ChatLogTimelineItem, ChatLogWorkEvent } from "@/lib/teacherApi";
import { DEFAULT_LOCALE, translate, type Translate } from "@/i18n";
import { parseWorkValue, workLabel } from "./ChatLogTranscript";

export const TIMELINE_CSV_HEADER = ["timestamp", "role", "content", "kind", "label"] as const;

/** Longest summary a single work cell carries — the card's own raw cap. */
const MAX_SUMMARY = 4000;

/** The element's state at that moment as one line of text: a table as its
 *  header and rows, writing as its text, calculators as inputs → result, a
 *  checklist as ☑/☐ items. Unknown shapes fall back to the raw value, capped. */
export function workSummary(
  ev: Pick<ChatLogWorkEvent, "value">,
  t: Translate<"ChatLogTranscript"> = translate(DEFAULT_LOCALE, "ChatLogTranscript"),
): string {
  const parsed = parseWorkValue(ev.value);
  if (!parsed) return "";
  switch (parsed.shape) {
    case "tables":
      return parsed.tables
        .map((tbl) => {
          const cols = tbl.columns ?? [];
          const head = cols.map((c) => (c.unit ? `${c.label} (${c.unit})` : c.label)).join(" | ");
          const rows = (tbl.data ?? []).map((row) => cols.map((c) => row?.[c.id] ?? "").join(" | "));
          return `${tbl.title || t("untitledTable")}: ${[head, ...rows].join("; ")}`;
        })
        .join("\n");
    case "docs":
      return parsed.docs.map((d) => `${d.title || t("untitledText")}: ${d.text ?? ""}`).join("\n");
    case "calculators":
      return parsed.calculators
        .map((c) => {
          const inputs = (c.inputs ?? [])
            .map((i) => `${i.label} = ${i.value || "—"}${i.unit ? ` ${i.unit}` : ""}`)
            .join(", ");
          return `${c.title || c.formula}: ${inputs} → ${c.result ?? t("noResult")}`;
        })
        .join("\n");
    case "checklist":
      return parsed.items.map((i) => `${parsed.done.includes(i.id) ? "☑" : "☐"} ${i.label}`).join("; ");
    default:
      return parsed.text.slice(0, MAX_SUMMARY);
  }
}

/** One CSV row per timeline item, header first, in the timeline's own order —
 *  which IS time order: the server (and `timelineFromSummary`, the report-payload
 *  fallback) slot work between turns by time. Not re-sorted here, because a
 *  turn's transcript position outranks a second of clock skew. Timestamps are
 *  written raw (ISO), never the HH:MM the page displays. */
export function timelineToCsvRows(
  items: ChatLogTimelineItem[],
  t: Translate<"ChatLogTranscript"> = translate(DEFAULT_LOCALE, "ChatLogTranscript"),
): ReadonlyArray<ReadonlyArray<unknown>> {
  const rows: unknown[][] = [[...TIMELINE_CSV_HEADER]];
  for (const item of items) {
    if (item.kind === "turn") {
      rows.push([item.ts ?? "", item.role ?? "", item.content ?? "", "turn", ""]);
    } else {
      rows.push([item.ts ?? "", "", workSummary(item, t), "work", workLabel(item, t)]);
    }
  }
  return rows;
}

/** The timeline an export writes, and where it came from. */
export interface ExportTimeline {
  items: ChatLogTimelineItem[];
  /** "unreadable" = the workbench store could not be read — NOT "no work". */
  workStatus: "ok" | "unreadable";
  /** "server" = the labelled BigQuery timeline; "report" = the report's own
   *  payload interleaved (no labels, so work rows carry the derived fallback). */
  source: "server" | "report";
}

/** Pick the timeline to export: the labelled server timeline, read fresh at
 *  click time so an export never depends on the transcript being open; else
 *  the report's own payload, interleaved — the same fallback the page renders.
 *  An EMPTY server timeline beside a non-empty report (a session with no
 *  BigQuery rows yet) also falls back, so the export is never emptier than the
 *  screen. */
export async function resolveExportTimeline(
  readServer: () => Promise<ChatLogTimeline>,
  fromReport: () => ChatLogTimelineItem[],
): Promise<ExportTimeline> {
  try {
    const tl = await readServer();
    if (tl.items.length > 0) return { items: tl.items, workStatus: tl.workStatus, source: "server" };
  } catch {
    /* fall through to the report's own payload */
  }
  return { items: fromReport(), workStatus: "ok", source: "report" };
}
