/**
 * Tests for the /teacher/insights page shell.
 *
 * - Renders loading then the table.
 * - Shows the error banner when fetch fails.
 * - Switching the since dropdown refetches.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import TeacherInsightsPage from "@/app/teacher/insights/page";
import type { InsightsComparePayload } from "@/lib/insightsApi";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/teacher/insights",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const fetchCompare = vi.fn();

vi.mock("@/lib/insightsApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/insightsApi")>("@/lib/insightsApi");
  return { ...actual, fetchInsightsCompare: (...args: unknown[]) => fetchCompare(...args) };
});

vi.mock("@/components/teacher/insights/CrossClassTable", () => ({
  CrossClassTable: ({ rows }: { rows: unknown[] }) => (
    <div data-testid="table-stub">rows={rows.length}</div>
  ),
}));

let isResearcher = false;
vi.mock("@/hooks/useIsResearcher", () => ({
  useIsResearcher: () => isResearcher,
}));

const PAYLOAD: InsightsComparePayload = {
  since: "2026-05-26T00:00:00+00:00",
  until: "2026-06-02T00:00:00+00:00",
  rows: [
    {
      classId: "c1",
      name: "9A",
      activeGroups: 2,
      messages: 50,
      messagesPrior: 40,
      messagesDelta: 10,
      simRuns: 4,
      lastActivity: null,
    },
  ],
};

beforeEach(() => {
  fetchCompare.mockReset();
  isResearcher = false;
});

describe("/teacher/insights — page shell", () => {
  it("renders header and loading then the table", async () => {
    fetchCompare.mockResolvedValueOnce(PAYLOAD);
    render(<TeacherInsightsPage />);
    expect(screen.getByText("Insights", { selector: "h1" })).toBeInTheDocument();
    expect(screen.getByTestId("loading")).toBeInTheDocument();
    const table = await screen.findByTestId("table-stub");
    expect(table).toHaveTextContent("rows=1");
  });

  it("shows the window label", async () => {
    fetchCompare.mockResolvedValueOnce(PAYLOAD);
    render(<TeacherInsightsPage />);
    await screen.findByTestId("table-stub");
    expect(screen.getByTestId("window-label")).toHaveTextContent("Last 7 days");
  });

  it("renders an error banner on fetch failure", async () => {
    fetchCompare.mockRejectedValueOnce(new Error("Backend hiccup"));
    render(<TeacherInsightsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Backend hiccup");
  });

  it("changing the since dropdown refetches with the new value (own scope)", async () => {
    fetchCompare.mockResolvedValue(PAYLOAD);
    render(<TeacherInsightsPage />);
    await screen.findByTestId("table-stub");

    const select = screen.getByLabelText("Time window") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "30d" } });

    await waitFor(() => {
      expect(fetchCompare).toHaveBeenLastCalledWith("30d", undefined, "own");
    });
    expect(screen.getByTestId("window-label")).toHaveTextContent("Last 30 days");
  });

  it("hides the scope toggle for a non-researcher", async () => {
    fetchCompare.mockResolvedValueOnce(PAYLOAD);
    render(<TeacherInsightsPage />);
    await screen.findByTestId("table-stub");
    expect(screen.queryByRole("group", { name: "Class scope" })).not.toBeInTheDocument();
    expect(fetchCompare).toHaveBeenLastCalledWith("7d", undefined, "own");
  });

  it("researcher can switch to all-teachers scope and refetches with scope=all", async () => {
    isResearcher = true;
    fetchCompare.mockResolvedValue(PAYLOAD);
    render(<TeacherInsightsPage />);
    await screen.findByTestId("table-stub");

    fireEvent.click(screen.getByRole("button", { name: "All teachers" }));

    await waitFor(() => {
      expect(fetchCompare).toHaveBeenLastCalledWith("7d", undefined, "all");
    });
    expect(screen.getByTestId("window-label")).toHaveTextContent("all teachers");
  });
});
