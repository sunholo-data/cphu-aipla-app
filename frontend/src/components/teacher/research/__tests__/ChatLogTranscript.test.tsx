import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ChatLogTimelineItem } from "@/lib/teacherApi";

import { ChatLogTranscript, collapseWork, parseWorkValue, timelineFromSummary, workLabel } from "../ChatLogTranscript";

function work(ts: string, over: Partial<Extract<ChatLogTimelineItem, { kind: "work" }>> = {}): ChatLogTimelineItem {
  return { kind: "work", ts, server: "table", tool: "state", field: "state", value: null, label: null, ...over };
}

function turn(i: number, content: string): ChatLogTimelineItem {
  return { kind: "turn", ts: null, turn_index: i, role: "student", content, is_synthetic: false } as never;
}

const TABLE_VALUE = JSON.stringify({
  tables: [
    {
      title: "Fald",
      columns: [
        { id: "h", label: "Højde", unit: "m" },
        { id: "t", label: "Tid", unit: "s" },
      ],
      data: [
        { h: "1.2", t: "0.49" },
        { h: "2.0", t: "" },
      ],
    },
  ],
  lastEvent: "table.commit",
});

describe("collapseWork — a burst of edits is one card", () => {
  it("folds same-element events within 30 s into one burst", () => {
    const rows = collapseWork([
      work("2026-09-22T09:00:00Z"),
      work("2026-09-22T09:00:20Z"),
      work("2026-09-22T09:00:45Z"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind === "burst" && rows[0].events.length).toBe(3);
  });

  it("starts a new card after a 30 s gap, a turn, or a different element", () => {
    const rows = collapseWork([
      work("2026-09-22T09:00:00Z"),
      work("2026-09-22T09:01:00Z"), // gap
      turn(1, "hej"),
      work("2026-09-22T09:01:05Z"), // after a turn
      work("2026-09-22T09:01:06Z", { server: "calculator" }), // other element
    ]);
    expect(rows.map((r) => (r.kind === "burst" ? `b${r.events.length}` : "t"))).toEqual(["b1", "b1", "t", "b1", "b1"]);
  });
});

describe("workLabel", () => {
  it("prefers the event's own label — the trust-card text", () => {
    expect(workLabel({ ts: null, server: "table", tool: "state", field: "state", value: null, label: "Fald shared (3 cells)" })).toBe(
      "Fald shared (3 cells)",
    );
  });

  it("derives a label for rows logged before labels existed", () => {
    const base = { ts: null, tool: "state", field: "state", value: null, label: null };
    expect(workLabel({ ...base, server: "table" })).toBe("Data table updated");
    expect(workLabel({ ...base, server: "writing" })).toBe("Writing updated");
    expect(workLabel({ ...base, server: "boldkast", field: "v0" })).toBe("boldkast · v0");
    expect(workLabel({ ...base, server: "documents", tool: "document.open" })).toBe("Document: document.open");
  });
});

describe("parseWorkValue", () => {
  it("recognises each element's snapshot shape", () => {
    expect(parseWorkValue(TABLE_VALUE)?.shape).toBe("tables");
    expect(parseWorkValue(JSON.stringify({ docs: [] }))?.shape).toBe("docs");
    expect(parseWorkValue(JSON.stringify({ calculators: [] }))?.shape).toBe("calculators");
    expect(parseWorkValue(JSON.stringify({ items: [], done: [] }))?.shape).toBe("checklist");
    expect(parseWorkValue("17.5")?.shape).toBe("raw");
    expect(parseWorkValue("not json")).toEqual({ shape: "raw", text: "not json" });
    expect(parseWorkValue(null)).toBeNull();
  });
});

describe("ChatLogTranscript — work cards", () => {
  it("shows a burst's count and expands the LAST event into a grid", async () => {
    render(
      <ChatLogTranscript
        status="ok"
        items={[
          turn(0, "is our slope right?"),
          work("2026-09-22T09:00:00Z", { label: "Fald shared (1 cell)" }),
          work("2026-09-22T09:00:10Z", { label: "Fald shared (3 cells)", value: TABLE_VALUE }),
        ]}
      />,
    );
    expect(screen.getByText("Fald shared (3 cells)")).toBeInTheDocument();
    expect(screen.queryByText("Fald shared (1 cell)")).not.toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /show what they had/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("columnheader", { name: /Højde/ })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "0.49" })).toBeInTheDocument();
  });
});

describe("timelineFromSummary — the report's fallback", () => {
  it("slots work between turns by time and keeps the full value", () => {
    const items = timelineFromSummary(
      [
        { timestamp: "2026-09-22T09:00:00Z", role: "student", content: "a" },
        { timestamp: "2026-09-22T09:02:00Z", role: "tutor", content: "b" },
      ],
      [{ timestamp: "2026-09-22T09:01:00Z", server: "table", tool: "state", field: "state", value: TABLE_VALUE }],
    );
    expect(items.map((i) => i.kind)).toEqual(["turn", "work", "turn"]);
    const w = items[1];
    expect(w.kind === "work" && w.value).toBe(TABLE_VALUE);
  });
});
