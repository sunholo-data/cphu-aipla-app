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

import { WorkspaceElements } from "../elementRenderers";

const CHECK = [{ id: "a", label: "A" }];
const TABLE = [{ id: "t1", title: "T", columns: [{ id: "c", label: "C" }], rows: 2 }];
const CHART = [{ id: "c1", chartKind: "scatter" as const }];

describe("WorkspaceElements dispatch (1.1.38 M1/M2)", () => {
  it("renders nothing when no workspace element is present", () => {
    const { container } = render(
      <WorkspaceElements skillId="s" checklist={[]} table={[]} chart={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders only the checklist when only a checklist is present", () => {
    render(<WorkspaceElements skillId="s" checklist={CHECK} table={[]} chart={[]} />);
    expect(screen.getByTestId("checklist")).toBeInTheDocument();
    expect(screen.queryByTestId("table")).not.toBeInTheDocument();
  });

  it("renders only the table when only a table is present", () => {
    render(<WorkspaceElements skillId="s" checklist={[]} table={TABLE} chart={[]} />);
    expect(screen.getByTestId("table")).toBeInTheDocument();
    expect(screen.queryByTestId("checklist")).not.toBeInTheDocument();
  });

  it("renders the chart when present", () => {
    render(<WorkspaceElements skillId="s" checklist={[]} table={TABLE} chart={CHART} />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });

  it("stacks all present elements", () => {
    render(<WorkspaceElements skillId="s" checklist={CHECK} table={TABLE} chart={CHART} />);
    expect(screen.getByTestId("checklist")).toBeInTheDocument();
    expect(screen.getByTestId("table")).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });
});
