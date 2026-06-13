import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TeacherClassesPage from "@/app/teacher/classes/page";
import * as teacherApi from "@/lib/teacherApi";
import * as insightsApi from "@/lib/insightsApi";
import * as researcherHook from "@/hooks/useIsResearcher";
import type { ClassPayload } from "@/lib/teacherApi";

function makeClass(overrides: Partial<ClassPayload> = {}): ClassPayload {
  return {
    classId: "c-1",
    ownerUid: "teacher-1",
    name: "Physik 9A",
    description: null,
    tagNamespace: "class:teacher-1:c-1",
    lessons: [],
    groupCodes: [],
    revoked: false,
    createdAt: "2026-05-26T00:00:00Z",
    updatedAt: "2026-05-26T00:00:00Z",
    revokedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(teacherApi, "listClassRecentSessions").mockResolvedValue([]);
  vi.spyOn(teacherApi, "listAccessibleSkills").mockResolvedValue([]);
  vi.spyOn(insightsApi, "fetchInsightsSummary").mockResolvedValue({
    since: "2026-05-26T00:00:00+00:00",
    until: "2026-06-02T00:00:00+00:00",
    classes: [],
  });
  vi.spyOn(insightsApi, "fetchInsightsCompare").mockResolvedValue({
    since: "2026-05-26T00:00:00+00:00",
    until: "2026-06-02T00:00:00+00:00",
    rows: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/teacher/classes — Research view (1.1.5)", () => {
  it("hides the Research view toggle for non-researchers", async () => {
    vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(false);
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([makeClass({ name: "Mine" })]);

    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Mine" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Research view" })).not.toBeInTheDocument();
  });

  it("shows the toggle for researchers and switches to scope=all on click", async () => {
    vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(true);
    const listSpy = vi.spyOn(teacherApi, "listClasses").mockImplementation(async (scope) =>
      scope === "all"
        ? [
            makeClass({ classId: "mine", name: "Mine", ownerUid: "me" }),
            makeClass({ classId: "theirs", name: "Theirs", ownerUid: "other-teacher" }),
          ]
        : [makeClass({ classId: "mine", name: "Mine", ownerUid: "me" })],
    );

    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith("own");
    });
    // Other teacher's class not visible in My classes scope.
    expect(screen.queryByRole("heading", { name: "Theirs" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Research view" }));

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith("all");
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Theirs" })).toBeInTheDocument();
    });
    // Owner labels are surfaced in Research view.
    expect(screen.getAllByTestId("class-owner").length).toBeGreaterThan(0);
    expect(screen.getByText(/Owner: other-teacher/)).toBeInTheDocument();
  });
});
