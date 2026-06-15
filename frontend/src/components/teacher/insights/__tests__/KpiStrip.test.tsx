import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KpiStrip } from "@/components/teacher/insights/KpiStrip";

describe("KpiStrip", () => {
  it("shows 'Loading engagement…' only while the round-trip is in flight", () => {
    render(<KpiStrip summary={undefined} loading />);
    expect(screen.getByTestId("kpi-strip-loading")).toHaveTextContent(
      /loading engagement/i,
    );
  });

  it("shows 'No activity yet' (not a perpetual loading) when loaded with no summary", () => {
    render(<KpiStrip summary={undefined} loading={false} />);
    expect(screen.getByTestId("kpi-strip-loading")).toHaveTextContent(
      /no activity yet/i,
    );
  });

  it("renders activeGroups + totalMessages + last-activity relative", () => {
    render(
      <KpiStrip
        summary={{
          classId: "c1",
          name: "9A",
          activeGroups: 3,
          totalMessages: 42,
          lastActivity: new Date(Date.now() - 5 * 60_000).toISOString(),
        }}
      />,
    );
    const strip = screen.getByTestId("kpi-strip");
    expect(strip).toHaveTextContent("3");
    expect(strip).toHaveTextContent("42");
    expect(strip.textContent).toMatch(/m ago/);
  });

  it("formats 'none' when lastActivity is null", () => {
    render(
      <KpiStrip
        summary={{
          classId: "c1",
          name: "9A",
          activeGroups: 0,
          totalMessages: 0,
          lastActivity: null,
        }}
      />,
    );
    expect(screen.getByTestId("kpi-strip")).toHaveTextContent("none");
  });
});
