import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TeacherGroupReportPage from "@/app/teacher/reports/groups/[groupId]/page";
import { getMockSessionReport } from "@/app/teacher/_mock-data";

const groupId = "bold-kazoo-87";
const report = getMockSessionReport(groupId)!;

describe("/teacher/reports/groups/[groupId] — single-group report", () => {
  it("renders activity name, session label, and summary metrics", async () => {
    const ui = await TeacherGroupReportPage({
      params: Promise.resolve({ groupId }),
    });
    const { container } = render(ui);

    expect(screen.getByText(report.activityName)).toBeInTheDocument();
    expect(container.textContent).toContain(report.startedAtLabel);
    expect(
      screen.getByText(new RegExp(`${report.durationMinutes}\\s*min`)),
    ).toBeInTheDocument();
    expect(screen.getByText(String(report.messageCount))).toBeInTheDocument();
    expect(screen.getByText(String(report.simRunCount))).toBeInTheDocument();
  });

  it("renders the conversation log turns from mock data", async () => {
    const ui = await TeacherGroupReportPage({
      params: Promise.resolve({ groupId }),
    });
    render(ui);

    for (const turn of report.conversation) {
      expect(screen.getByText(turn.content)).toBeInTheDocument();
    }
  });
});
