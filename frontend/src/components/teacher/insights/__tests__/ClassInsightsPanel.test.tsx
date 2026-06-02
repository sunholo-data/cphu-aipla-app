/**
 * ClassInsightsPanel tests — covers the per-card error boundary
 * (simulated one-card failure leaves the rest intact) which is an
 * M9 sprint-acceptance requirement.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/components/teacher/insights/_chartsBundle", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

const fetchKpis = vi.fn();
const fetchGroups = vi.fn();
const fetchActivities = vi.fn();
const fetchTrend = vi.fn();

vi.mock("@/lib/insightsApi", () => ({
  fetchInsightsClassKpis: (...a: unknown[]) => fetchKpis(...a),
  fetchInsightsClassGroups: (...a: unknown[]) => fetchGroups(...a),
  fetchInsightsClassActivities: (...a: unknown[]) => fetchActivities(...a),
  fetchInsightsClassTrend: (...a: unknown[]) => fetchTrend(...a),
}));

import { ClassInsightsPanel } from "@/components/teacher/insights/ClassInsightsPanel";

beforeEach(() => {
  fetchKpis.mockReset();
  fetchGroups.mockReset();
  fetchActivities.mockReset();
  fetchTrend.mockReset();
});

const KPI_PAYLOAD = {
  classId: "c1",
  since: "2026-05-26T00:00:00+00:00",
  until: "2026-06-02T00:00:00+00:00",
  kpis: {
    activeGroups: 3,
    totalMessages: 142,
    activeActivities: 2,
    simRuns: 7,
    medianTimeOnTaskMin: 18,
    lastActivity: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  _debug: { queries: [{ name: "count_messages", sql: "SELECT 1", params: { since: "x" } }] },
};

const GROUPS_PAYLOAD = {
  classId: "c1",
  groups: [{ groupCode: "g1", messageCount: 60, sessionCount: 4 }],
  _debug: { queries: [] },
};

const ACTIVITIES_PAYLOAD = {
  classId: "c1",
  activities: [{ skillId: "physics-101", activeGroups: 2, simRuns: 5 }],
  _debug: { queries: [] },
};

const TREND_PAYLOAD = {
  classId: "c1",
  perDay: [{ day: "2026-06-01", count: 3 }],
  _debug: { queries: [] },
};

describe("ClassInsightsPanel", () => {
  it("renders all four sections when every fetch succeeds", async () => {
    fetchKpis.mockResolvedValueOnce(KPI_PAYLOAD);
    fetchGroups.mockResolvedValueOnce(GROUPS_PAYLOAD);
    fetchActivities.mockResolvedValueOnce(ACTIVITIES_PAYLOAD);
    fetchTrend.mockResolvedValueOnce(TREND_PAYLOAD);

    render(<ClassInsightsPanel classId="c1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId("kpi-card").length).toBe(6);
    });
    expect(screen.getByText(/142/)).toBeInTheDocument(); // total messages
    expect(screen.getByText("Per-group activity")).toBeInTheDocument();
    expect(screen.getByText("Per-activity engagement")).toBeInTheDocument();
    expect(screen.getByText("Messages per day")).toBeInTheDocument();
  });

  it("one failing section leaves the others rendered", async () => {
    fetchKpis.mockResolvedValueOnce(KPI_PAYLOAD);
    fetchGroups.mockRejectedValueOnce(new Error("BQ slow"));
    fetchActivities.mockResolvedValueOnce(ACTIVITIES_PAYLOAD);
    fetchTrend.mockResolvedValueOnce(TREND_PAYLOAD);

    render(<ClassInsightsPanel classId="c1" />);

    // Groups section surfaces an error banner.
    const err = await screen.findByTestId("section-error-groups");
    expect(err).toHaveTextContent(/BQ slow/);

    // The other three sections still render their content.
    await waitFor(() => {
      expect(screen.getAllByTestId("kpi-card").length).toBe(6);
    });
    expect(screen.getByText("Per-activity engagement")).toBeInTheDocument();
    expect(screen.getByText("Messages per day")).toBeInTheDocument();
  });
});
