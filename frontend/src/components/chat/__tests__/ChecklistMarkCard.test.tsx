import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChecklistMarkCard, parseChecklistMarkResult } from "../ChecklistMarkCard";

/**
 * 1.1.62 M3 — the trust half of "the AI helps auto-grade".
 *
 * The tutor may now mark the teacher's ILOs from the conversation. The only
 * thing keeping that honest is the student SEEING every mark, with its reason,
 * and knowing they can undo it. A mark that renders as an opaque tool chip is
 * the feature failing quietly.
 */
describe("parseChecklistMarkResult", () => {
  it("parses a successful mark", () => {
    const parsed = parseChecklistMarkResult(
      JSON.stringify({ ok: true, item: { id: "a", label: "Mål faldtiden" }, done: true, evidence: "målte tre gange" }),
    );
    expect(parsed).toEqual({ itemLabel: "Mål faldtiden", done: true, evidence: "målte tre gange" });
  });

  it("returns null for a refused mark so it falls back to the generic chip", () => {
    // The tool refuses a tick with no evidence — that must not render as a card
    // claiming the step is done.
    expect(parseChecklistMarkResult(JSON.stringify({ ok: false, error: "evidence_summary is required" }))).toBeNull();
  });

  it("returns null on malformed or empty content", () => {
    expect(parseChecklistMarkResult("not json")).toBeNull();
    expect(parseChecklistMarkResult(null)).toBeNull();
    expect(parseChecklistMarkResult(JSON.stringify({ ok: true, item: {} }))).toBeNull();
  });
});

describe("ChecklistMarkCard", () => {
  it("names the step and shows the tutor's reason", () => {
    render(
      <ChecklistMarkCard result={{ itemLabel: "Mål faldtiden", done: true, evidence: "målte tre gange, 0,45 s" }} />,
    );
    expect(screen.getByText(/Mål faldtiden/)).toBeInTheDocument();
    expect(screen.getByText("målte tre gange, 0,45 s")).toBeInTheDocument();
  });

  it("tells the student they can change it", () => {
    render(<ChecklistMarkCard result={{ itemLabel: "Mål faldtiden", done: true, evidence: "x" }} />);
    expect(screen.getByText(/kan ændre markeringen/i)).toBeInTheDocument();
  });

  it("renders an un-mark distinctly from a mark", () => {
    render(<ChecklistMarkCard result={{ itemLabel: "Mål faldtiden", done: false, evidence: "aflæsningen var forkert" }} />);
    expect(screen.getByText(/Ikke længere klar/)).toBeInTheDocument();
  });

  it("renders without evidence rather than crashing", () => {
    render(<ChecklistMarkCard result={{ itemLabel: "Step", done: true, evidence: "" }} />);
    expect(screen.getByTestId("checklist-mark-card")).toBeInTheDocument();
  });
});
