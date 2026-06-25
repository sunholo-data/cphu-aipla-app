import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Stub the leaf renderers — this exercises the dispatch (which kind renders
// when present / stacking), not the child components (covered by their own tests).
vi.mock("../ProgressChecklist", () => ({
  ProgressChecklist: () => <div data-testid="checklist" />,
}));
vi.mock("../WorkbenchTable", () => ({
  WorkbenchTable: () => <div data-testid="table" />,
}));
vi.mock("../WorkbenchChart", () => ({
  WorkbenchChart: () => <div data-testid="chart" />,
}));
vi.mock("../WorkbenchCalculator", () => ({
  WorkbenchCalculator: () => <div data-testid="calculator" />,
}));
vi.mock("../WorkbenchNote", () => ({
  WorkbenchNote: () => <div data-testid="note" />,
}));
vi.mock("../SolutionElementMount", () => ({
  SolutionElementMount: () => <div data-testid="solution" />,
}));
vi.mock("../DocumentElementMount", () => ({
  DocumentElementMount: () => <div data-testid="document" />,
}));

import { WorkspaceElements } from "../elementRenderers";

const CHECK = [{ id: "a", label: "A" }];
const TABLE = [{ id: "t1", title: "T", columns: [{ id: "c", label: "C" }], rows: 2 }];
const CHART = [{ id: "c1", chartKind: "scatter" as const }];
const CALC = [{ id: "calc1", formula: "s", inputs: [{ id: "s", label: "S" }] }];
const NOTE = [{ id: "n1", body: "hej" }];
const SOLUTION = [{ id: "sol1", prompt: "Solve it" }];
const DOCUMENT = [{ id: "doc1", prompt: "Upload" }];
const EMPTY = { checklist: [], table: [], chart: [], calculator: [], note: [], solution: [], document: [] };

describe("WorkspaceElements dispatch (1.1.38 M1–M4)", () => {
  it("renders nothing when no workspace element is present", () => {
    const { container } = render(<WorkspaceElements skillId="s" {...EMPTY} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders only the checklist when only a checklist is present", () => {
    render(<WorkspaceElements skillId="s" {...EMPTY} checklist={CHECK} />);
    expect(screen.getByTestId("checklist")).toBeInTheDocument();
    expect(screen.queryByTestId("table")).not.toBeInTheDocument();
  });

  it("renders the table when present", () => {
    render(<WorkspaceElements skillId="s" {...EMPTY} table={TABLE} />);
    expect(screen.getByTestId("table")).toBeInTheDocument();
  });

  it("renders the chart when present", () => {
    render(<WorkspaceElements skillId="s" {...EMPTY} chart={CHART} />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });

  it("renders the calculator when present", () => {
    render(<WorkspaceElements skillId="s" {...EMPTY} calculator={CALC} />);
    expect(screen.getByTestId("calculator")).toBeInTheDocument();
  });

  it("renders the note when present", () => {
    render(<WorkspaceElements skillId="s" {...EMPTY} note={NOTE} />);
    expect(screen.getByTestId("note")).toBeInTheDocument();
  });

  it("renders the solution editor when present (1.1.45 M4)", () => {
    render(<WorkspaceElements skillId="s" {...EMPTY} solution={SOLUTION} />);
    expect(screen.getByTestId("solution")).toBeInTheDocument();
  });

  it("renders the document upload when present (1.1.48)", () => {
    render(<WorkspaceElements skillId="s" {...EMPTY} document={DOCUMENT} />);
    expect(screen.getByTestId("document")).toBeInTheDocument();
  });

  it("stacks all present elements", () => {
    render(
      <WorkspaceElements
        skillId="s"
        checklist={CHECK}
        table={TABLE}
        chart={CHART}
        calculator={CALC}
        note={NOTE}
        solution={SOLUTION}
        document={DOCUMENT}
      />,
    );
    for (const id of ["checklist", "table", "chart", "calculator", "note", "solution", "document"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});
