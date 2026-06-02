import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
    fetchGroupLatestReport: vi.fn(async () => {
      // Default in Phase 1/2 test surface: pretend the report doesn't exist
      // on the backend yet so the page falls back to mock fixtures.
      throw new actual.NotFoundError();
    }),
  };
});

import TeacherGroupReportPage from "@/app/teacher/reports/groups/[groupId]/page";
import { getMockSessionReport } from "@/app/teacher/_mock-data";

const mockReport = getMockSessionReport(groupId)!;

describe("/teacher/reports/groups/[groupId] — single-group report (mock fallback)", () => {
  it("renders activity name, session label, and summary metrics from the mock", async () => {
    const { container } = render(<TeacherGroupReportPage />);

    await waitFor(() => {
      expect(screen.queryByText(/loading report/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText(mockReport.activityName)).toBeInTheDocument();
    expect(container.textContent).toContain(mockReport.startedAtLabel);
    expect(
      screen.getByText(new RegExp(`${mockReport.durationMinutes}\\s*min`)),
    ).toBeInTheDocument();
    expect(screen.getByText(String(mockReport.messageCount))).toBeInTheDocument();
    expect(screen.getByText(String(mockReport.simRunCount))).toBeInTheDocument();
  });

  it("renders the conversation log turns from the mock", async () => {
    render(<TeacherGroupReportPage />);

    await waitFor(() => {
      expect(screen.queryByText(/loading report/i)).not.toBeInTheDocument();
    });

    for (const turn of mockReport.conversation) {
      expect(screen.getByText(turn.content)).toBeInTheDocument();
    }
  });
});
