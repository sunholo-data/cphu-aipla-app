import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/teacher/insights/_chartsBundle", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

import { TrendSparkline } from "@/components/teacher/insights/TrendSparkline";

describe("TrendSparkline", () => {
  it("renders empty state with no points", () => {
    render(<TrendSparkline points={[]} />);
    expect(screen.getByTestId("trend-empty")).toBeInTheDocument();
  });

  it("renders an a11y summary with total + peak", () => {
    render(
      <TrendSparkline
        points={[
          { day: "2026-06-01", count: 3 },
          { day: "2026-06-02", count: 7 },
        ]}
      />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAccessibleName(/2 days, total 10, peak 7/i);
    // Table fallback contains the rows.
    expect(screen.getByText("2026-06-01")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
