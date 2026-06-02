import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// recharts pulls in browser-only dependencies; stub the chart bundle
// for unit tests so we exercise our wrapper logic + a11y / table
// fallback without the renderer.
vi.mock("@/components/teacher/insights/_chartsBundle", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart-container">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

import { EngagementBar } from "@/components/teacher/insights/EngagementBar";

describe("EngagementBar", () => {
  it("renders an empty state with no rows", () => {
    render(<EngagementBar rows={[]} title="Per-group activity" primaryLabel="Messages" />);
    expect(screen.getByTestId("engagement-bar-empty")).toBeInTheDocument();
  });

  it("renders the chart and the table fallback", () => {
    render(
      <EngagementBar
        title="Per-group activity"
        primaryLabel="Messages"
        rows={[
          { label: "g1", value: 10 },
          { label: "g2", value: 4 },
        ]}
      />,
    );
    expect(screen.getByTestId("chart-container")).toBeInTheDocument();
    // a11y summary describes the chart
    const img = screen.getByRole("img");
    expect(img).toHaveAccessibleName(/per-group activity.*total messages 14/i);
    // Show-data table fallback contains the rows.
    expect(screen.getByText("g1")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("renders a second-bar header when secondaryLabel given", () => {
    render(
      <EngagementBar
        title="Per-activity"
        primaryLabel="Active groups"
        secondaryLabel="Sim runs"
        rows={[{ label: "skill-a", value: 2, secondaryValue: 5 }]}
      />,
    );
    expect(screen.getByText("Sim runs")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
