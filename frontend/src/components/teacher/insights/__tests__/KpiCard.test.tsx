import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KpiCard } from "@/components/teacher/insights/KpiCard";

describe("KpiCard", () => {
  it("renders label and value", () => {
    render(<KpiCard label="Active groups" value={3} definition="Groups with >=1 msg." />);
    expect(screen.getByText("Active groups")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders em dash when value is null", () => {
    render(<KpiCard label="Last activity" value={null} definition="..." />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("toggles the definition tooltip", () => {
    render(<KpiCard label="X" value={1} definition="Definition body." />);
    expect(screen.queryByTestId("kpi-definition")).not.toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /definition: definition body/i });
    fireEvent.click(btn);
    expect(screen.getByTestId("kpi-definition")).toHaveTextContent("Definition body.");
    fireEvent.click(btn);
    expect(screen.queryByTestId("kpi-definition")).not.toBeInTheDocument();
  });

  it("renders Show data disclosure when queries provided", () => {
    render(
      <KpiCard
        label="X"
        value={1}
        definition="..."
        queries={[{ name: "count_messages", sql: "SELECT 1", params: { since: "x" } }]}
      />,
    );
    expect(screen.getByText("Show data")).toBeInTheDocument();
    expect(screen.getByText("count_messages")).toBeInTheDocument();
    expect(screen.getByText("SELECT 1")).toBeInTheDocument();
  });

  it("omits Show data when queries empty", () => {
    render(<KpiCard label="X" value={1} definition="..." queries={[]} />);
    expect(screen.queryByText("Show data")).not.toBeInTheDocument();
  });
});
