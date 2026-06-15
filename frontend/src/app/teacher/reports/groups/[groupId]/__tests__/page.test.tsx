import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const groupId = "bold-kazoo-87";

vi.mock("next/navigation", () => ({
  useParams: () => ({ groupId }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

vi.mock("@/lib/teacherApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teacherApi")>(
    "@/lib/teacherApi",
  );
  return {
    ...actual,
    fetchGroupLatestReport: vi.fn(),
  };
});

import TeacherGroupReportPage from "@/app/teacher/reports/groups/[groupId]/page";
import {
  NotFoundError,
  type SessionSummaryPayload,
  fetchGroupLatestReport,
} from "@/lib/teacherApi";

const fetchReport = vi.mocked(fetchGroupLatestReport);

const LIVE_REPORT: SessionSummaryPayload = {
  sessionId: "sess-12345678",
  groupCode: groupId,
  activityId: "Boldkast projectile motion",
  startedAt: "2026-06-15T09:30:00Z",
  endedAt: "2026-06-15T09:48:00Z",
  durationSeconds: 1080, // 18 min
  messageCount: 14,
  simRunCount: 5,
  conversation: [
    { timestamp: "2026-06-15T09:31:00Z", role: "student", content: "Hej, hjælp med opgave 1" },
    { timestamp: "2026-06-15T09:32:00Z", role: "tutor", content: "Hvilken delopgave vil du starte med?" },
  ],
  narrative: null,
};

beforeEach(() => {
  fetchReport.mockReset();
});

describe("/teacher/reports/groups/[groupId] — real session report", () => {
  it("renders activity name, session label, and summary metrics from live data", async () => {
    fetchReport.mockResolvedValueOnce(LIVE_REPORT);
    const { container } = render(<TeacherGroupReportPage />);

    await waitFor(() => {
      expect(screen.queryByText(/loading report/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText(LIVE_REPORT.activityId)).toBeInTheDocument();
    expect(container.textContent).toContain("2026-06-15 09:30");
    expect(screen.getByText(/18\s*min/)).toBeInTheDocument();
    expect(screen.getByText(String(LIVE_REPORT.messageCount))).toBeInTheDocument();
    expect(screen.getByText(String(LIVE_REPORT.simRunCount))).toBeInTheDocument();
    // No mock-data badge should ever appear.
    expect(screen.queryByText(/mock data/i)).not.toBeInTheDocument();
  });

  it("collapses the transcript by default and reveals it on toggle (1.1.4)", async () => {
    fetchReport.mockResolvedValueOnce(LIVE_REPORT);
    render(<TeacherGroupReportPage />);

    await waitFor(() => {
      expect(screen.queryByText(/loading report/i)).not.toBeInTheDocument();
    });

    expect(
      screen.queryByText(LIVE_REPORT.conversation[0].content),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /view full transcript/i }),
    );

    for (const turn of LIVE_REPORT.conversation) {
      expect(screen.getByText(turn.content)).toBeInTheDocument();
    }
  });

  it("shows an honest empty state (no mock) when no session exists yet", async () => {
    fetchReport.mockRejectedValueOnce(new NotFoundError());
    render(<TeacherGroupReportPage />);

    expect(await screen.findByText(/no sessions yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/mock data/i)).not.toBeInTheDocument();
  });

  it("shows an error state when the load fails (non-404)", async () => {
    fetchReport.mockRejectedValueOnce(new Error("boom"));
    render(<TeacherGroupReportPage />);

    expect(await screen.findByText(/couldn.t load this report/i)).toBeInTheDocument();
  });
});
