import { describe, expect, it } from "vitest";

import { translate } from "@/i18n";
import { UTF8_BOM, parseCsv, toCsv } from "@/lib/download";
import type { ChatLogTimelineItem } from "@/lib/teacherApi";
import {
  TIMELINE_CSV_HEADER,
  resolveExportTimeline,
  timelineToCsvRows,
  workSummary,
} from "../timelineExport";

const tEn = translate("en", "ChatLogTranscript");

const turn = (ts: string, role: string, content: string): ChatLogTimelineItem =>
  ({ kind: "turn", ts, turn_index: 0, role, content, is_synthetic: false }) as never;
const work = (ts: string, server: string, value: string | null, label: string | null = null): ChatLogTimelineItem => ({
  kind: "work",
  ts,
  server,
  tool: "state",
  field: "state",
  value,
  label,
});

const TABLE = JSON.stringify({
  tables: [
    {
      title: "Målinger",
      columns: [
        { id: "t", label: "t", unit: "s" },
        { id: "x", label: "x", unit: "m" },
      ],
      data: [
        { t: "0", x: "0" },
        { t: "1", x: "4,9" },
      ],
    },
  ],
});

describe("timelineToCsvRows (1.1.136 §Exports)", () => {
  const items = [
    turn("2026-09-22T09:31:00.123Z", "student", "Er vores hældning rigtig?"),
    work("2026-09-22T09:31:20Z", "table", TABLE, "Data table: Målinger"),
    turn("2026-09-22T09:32:00Z", "tutor", "Hvad er enheden på x?"),
    work("2026-09-22T09:32:30Z", "writing", JSON.stringify({ docs: [{ title: "Rapport", text: "Kuglen falder" }] })),
  ];

  it("writes turns and work interleaved, in time order, with the old columns first", () => {
    const rows = timelineToCsvRows(items, tEn);
    expect(rows[0]).toEqual([...TIMELINE_CSV_HEADER]);
    expect(rows[0].slice(0, 3)).toEqual(["timestamp", "role", "content"]); // the chat-only file's columns
    expect(rows.slice(1).map((r) => r[3])).toEqual(["turn", "work", "turn", "work"]);
    // Raw ISO timestamps — never the page's HH:MM.
    expect(rows[1][0]).toBe("2026-09-22T09:31:00.123Z");
    expect(rows[2]).toEqual([
      "2026-09-22T09:31:20Z",
      "",
      "Målinger: t (s) | x (m); 0 | 0; 1 | 4,9",
      "work",
      "Data table: Målinger",
    ]);
  });

  it("gives an unlabelled (pre-1.1.136) work row the cards' fallback label", () => {
    const rows = timelineToCsvRows(items, tEn);
    expect(rows[4][4]).toBe("Writing updated");
    expect(rows[4][2]).toBe("Rapport: Kuglen falder");
  });

  it("never writes the raw snapshot JSON into the CSV", () => {
    const csv = toCsv(timelineToCsvRows(items, tEn));
    expect(csv).not.toContain('"tables"');
    expect(csv).not.toContain('"docs"');
  });

  it("round-trips through the BOM-first CSV with Danish intact", () => {
    const csv = toCsv(timelineToCsvRows(items, tEn));
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    const parsed = parseCsv(csv);
    expect(parsed[1][2]).toBe("Er vores hældning rigtig?");
    expect(parsed[2][2]).toContain("4,9"); // a comma inside a cell survives quoting
  });
});

describe("workSummary", () => {
  it("summarises calculators and checklists the way the card shows them", () => {
    const calc = JSON.stringify({
      calculators: [{ title: "Fart", formula: "v=s/t", inputs: [{ label: "s", value: "10", unit: "m" }], result: "5" }],
    });
    expect(workSummary({ value: calc }, tEn)).toBe("Fart: s = 10 m → 5");
    const list = JSON.stringify({ items: [{ id: "a", label: "Mål" }, { id: "b", label: "Plot" }], done: ["a"] });
    expect(workSummary({ value: list }, tEn)).toBe("☑ Mål; ☐ Plot");
    expect(workSummary({ value: null }, tEn)).toBe("");
  });
});

describe("resolveExportTimeline", () => {
  const report = [turn("2026-09-22T09:31:00Z", "student", "hej")];

  it("prefers the labelled server timeline", async () => {
    const server = [work("2026-09-22T09:31:00Z", "table", null, "Data table")];
    const tl = await resolveExportTimeline(
      async () => ({ sessionId: "s", items: server, workStatus: "unreadable" }),
      () => report,
    );
    expect(tl).toEqual({ items: server, workStatus: "unreadable", source: "server" });
  });

  it("falls back to the report's own payload when the server cannot be read or is empty", async () => {
    const failed = await resolveExportTimeline(() => Promise.reject(new Error("404")), () => report);
    expect(failed.source).toBe("report");
    expect(failed.items).toBe(report);
    const empty = await resolveExportTimeline(async () => ({ sessionId: "s", items: [], workStatus: "ok" }), () => report);
    expect(empty.source).toBe("report");
  });
});
