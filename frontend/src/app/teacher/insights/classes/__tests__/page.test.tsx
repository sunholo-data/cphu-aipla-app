/**
 * /teacher/insights/classes — "All classes" (UI sweep 2026-11-11).
 *
 * The one home of the cross-class table: it carries the spend column and the
 * four totals that used to sit in the class list's "insights & spend" panel,
 * keeps its window and (researcher) scope in the URL, and shows a failed read
 * as a failure with Retry — never as "no engagement".
 */

import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";
import type { InsightsComparePayload, InsightsSummaryPayload } from "@/lib/insightsApi";

vi.mock("next/navigation", async () => (await import("@/test/nextNavigationMock")).navigationModule);
import { nav } from "@/test/nextNavigationMock";

const fetchCompare = vi.fn();
const fetchSummary = vi.fn();
vi.mock("@/lib/insightsApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/insightsApi")>("@/lib/insightsApi");
  return {
    ...actual,
    fetchInsightsCompare: (...a: unknown[]) => fetchCompare(...a),
    fetchInsightsSummary: (...a: unknown[]) => fetchSummary(...a),
  };
});
const fetchTeacherSpend = vi.fn();
const fetchCostInsights = vi.fn();
vi.mock("@/lib/costApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/costApi")>("@/lib/costApi");
  return {
    ...actual,
    fetchTeacherSpend: (...a: unknown[]) => fetchTeacherSpend(...a),
    fetchCostInsights: (...a: unknown[]) => fetchCostInsights(...a),
  };
});

let isResearcher = false;
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => isResearcher }));

import InsightsAllClassesPage from "@/app/teacher/insights/classes/page";

function render(ui: ReactElement) {
  return rtlRender(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

const COMPARE: InsightsComparePayload = {
  since: "2026-05-26T00:00:00+00:00",
  until: "2026-06-02T00:00:00+00:00",
  rows: [
    { classId: "a", name: "Class A", activeGroups: 2, messages: 50, messagesPrior: 40, messagesDelta: 10, simRuns: 3, lastActivity: null },
    { classId: "b", name: "Class B", activeGroups: 1, messages: 20, messagesPrior: 30, messagesDelta: -10, simRuns: 0, lastActivity: null },
  ],
};
const SUMMARY: InsightsSummaryPayload = {
  since: "2026-05-26T00:00:00+00:00",
  until: "2026-06-02T00:00:00+00:00",
  classes: [
    { classId: "a", name: "Class A", activeGroups: 2, totalMessages: 50, lastActivity: null },
    { classId: "b", name: "Class B", activeGroups: 1, totalMessages: 20, lastActivity: null },
  ],
};

beforeEach(() => {
  nav.reset("/teacher/insights/classes");
  isResearcher = false;
  fetchCompare.mockReset().mockResolvedValue(COMPARE);
  fetchSummary.mockReset().mockResolvedValue(SUMMARY);
  fetchTeacherSpend.mockReset().mockResolvedValue({
    currency: "EUR",
    period: "this_month",
    total_eur: 1.23,
    per_class: [
      { class_id: "a", eur: 1.0 },
      { class_id: "b", eur: 0.23 },
    ],
  });
  fetchCostInsights.mockReset().mockResolvedValue({
    currency: "EUR",
    period: "this_month",
    total_eur: 9.5,
    by_cohort: [],
    by_model: [],
    per_class: [{ class_id: "a", name: "Class A", cohort: "x", eur: 9.5 }],
    voice_eur: 0,
    by_voice_kind: [],
  });
});

describe("/teacher/insights/classes — All classes", () => {
  it("shows the table with a spend column and the four totals from the old class-list panel", async () => {
    render(<InsightsAllClassesPage />);
    const table = await screen.findByTestId("cross-class-table");
    expect(within(table).getByRole("button", { name: /sort by spend/i })).toBeInTheDocument();
    await waitFor(() => expect(within(table).getByText("€1.00")).toBeInTheDocument());
    const totals = screen.getByTestId("insights-totals");
    expect(totals).toHaveTextContent("Active groups3");
    expect(totals).toHaveTextContent("Messages (30 days)70");
    expect(totals).toHaveTextContent("Spend (this month)€1.23");
    expect(totals).toHaveTextContent("Last activitynone");
    // Own classes for a teacher, 30-day window by default.
    expect(fetchCompare).toHaveBeenLastCalledWith("30d", undefined, "own");
    expect(fetchTeacherSpend).toHaveBeenCalledWith("this_month");
    expect(fetchCostInsights).not.toHaveBeenCalled();
  });

  it("keeps the window in the URL (?since=) and the header names it", async () => {
    render(<InsightsAllClassesPage />);
    await screen.findByTestId("cross-class-table");
    await userEvent.selectOptions(screen.getByLabelText("Time window"), "7d");
    expect(nav.search.get("since")).toBe("7d");
    await waitFor(() => expect(fetchCompare).toHaveBeenLastCalledWith("7d", undefined, "own"));
    expect(screen.getByTestId("window-label")).toHaveTextContent("Last 7 days");
    expect(await screen.findByRole("columnheader", { name: /Messages, 7d/ })).toBeInTheDocument();
  });

  it("opens on the window a link carries", async () => {
    nav.reset("/teacher/insights/classes", "since=all");
    render(<InsightsAllClassesPage />);
    await screen.findByTestId("cross-class-table");
    expect(fetchCompare).toHaveBeenLastCalledWith("all", undefined, "own");
  });

  it("hides the scope switch for a plain teacher", async () => {
    render(<InsightsAllClassesPage />);
    await screen.findByTestId("cross-class-table");
    expect(screen.queryByRole("group", { name: "Whose classes" })).not.toBeInTheDocument();
  });

  it("a researcher lands on all teachers' classes, with cross-class spend, and can switch to theirs", async () => {
    isResearcher = true;
    render(<InsightsAllClassesPage />);
    await screen.findByTestId("cross-class-table");
    expect(fetchCompare).toHaveBeenLastCalledWith("30d", undefined, "all");
    expect(fetchCostInsights).toHaveBeenCalledWith("this_month");
    expect(screen.getByRole("button", { name: "All teachers' classes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("insights-totals")).toHaveTextContent("€9.50");

    await userEvent.click(screen.getByRole("button", { name: "Your classes" }));
    expect(nav.search.get("scope")).toBe("own");
    await waitFor(() => expect(fetchCompare).toHaveBeenLastCalledWith("30d", undefined, "own"));
    expect(fetchTeacherSpend).toHaveBeenCalled();
  });

  it("a failed table read shows Retry, not the empty table — and Retry reads again", async () => {
    fetchCompare.mockReset().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(COMPARE);
    render(<InsightsAllClassesPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The class numbers could not be loaded");
    expect(screen.queryByTestId("cross-class-empty")).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("cross-class-table")).toBeInTheDocument();
    expect(fetchCompare).toHaveBeenCalledTimes(2);
  });

  it("a failed spend read says so and leaves the table without a spend column", async () => {
    fetchTeacherSpend.mockReset().mockRejectedValue(new Error("nope"));
    render(<InsightsAllClassesPage />);
    const table = await screen.findByTestId("cross-class-table");
    expect(await screen.findByRole("alert")).toHaveTextContent("Spend could not be loaded");
    expect(within(table).queryByRole("button", { name: /sort by spend/i })).not.toBeInTheDocument();
  });

  it("breadcrumbs to Classes, not 'Dashboard'", async () => {
    render(<InsightsAllClassesPage />);
    await screen.findByTestId("cross-class-table");
    expect(screen.getByRole("link", { name: "Classes" })).toHaveAttribute("href", "/teacher/classes");
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });
});
