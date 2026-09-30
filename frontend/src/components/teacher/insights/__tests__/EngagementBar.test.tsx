import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

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

// 1.1.108 — teacher screens follow the person's language, Danish by default.
// These tests assert the English copy, so they render inside an English
// context; the Danish default has its own assertion in teacherResearchLocale.test.tsx.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const result = rtlRender(wrap(ui), options);
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}

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

  it("wraps row labels in <Link> when hrefFor returns a target", () => {
    render(
      <EngagementBar
        title="Per-group activity"
        primaryLabel="Messages"
        rows={[
          { label: "bold-kazoo-87", value: 60 },
          { label: "neon-eel-12", value: 21 },
        ]}
        hrefFor={(r) => `/teacher/reports/groups/${r.label}`}
      />,
    );
    const link = screen.getByRole("link", { name: "bold-kazoo-87" });
    expect(link).toHaveAttribute("href", "/teacher/reports/groups/bold-kazoo-87");
  });

  it("renders plain text when hrefFor returns null", () => {
    render(
      <EngagementBar
        title="Per-activity"
        primaryLabel="Active groups"
        rows={[{ label: "skill-a", value: 2 }]}
        hrefFor={() => null}
      />,
    );
    expect(screen.queryByRole("link", { name: "skill-a" })).not.toBeInTheDocument();
    expect(screen.getByText("skill-a")).toBeInTheDocument();
  });
});
