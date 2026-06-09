import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { ActivityConfigPayload } from "@/lib/teacherApi";
import TeacherActivitiesPage from "@/app/teacher/activities/page";

function makeActivity(overrides: Partial<ActivityConfigPayload> = {}): ActivityConfigPayload {
  return {
    activityId: "concept-x",
    classId: "c-1",
    teacherUid: "t-1",
    title: "Energy basics",
    teachingGoal: "Discover conservation of energy",
    language: "da",
    difficulty: "standard",
    pairedWorkbench: null,
    workbenchType: "none",
    updatedAt: "2026-06-09T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeacherActivitiesPage", () => {
  it("shows an empty state with a New activity link when there are no activities", async () => {
    vi.spyOn(teacherApi, "listMyActivities").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1, name: "Activities" })).toBeInTheDocument();

    const newLinks = screen.getAllByRole("link", { name: /New activity/ });
    expect(newLinks.length).toBeGreaterThanOrEqual(1);
    expect(newLinks[0]).toHaveAttribute("href", "/teacher/activities/new");
  });

  it("lists the teacher's activities with a workbench-type badge and an Open-class link", async () => {
    vi.spyOn(teacherApi, "listMyActivities").mockResolvedValue([makeActivity()]);
    render(<TeacherActivitiesPage />);

    await waitFor(() => expect(screen.getByText("Energy basics")).toBeInTheDocument());
    expect(screen.getByText("Concept dialogue")).toBeInTheDocument(); // workbenchType=none label

    const classLink = screen.getByRole("link", { name: /Open class/ });
    expect(classLink).toHaveAttribute("href", "/teacher/classes/c-1");
  });

  it("degrades to an error empty-state when the list fails", async () => {
    vi.spyOn(teacherApi, "listMyActivities").mockRejectedValue(new Error("boom"));
    render(<TeacherActivitiesPage />);

    await waitFor(() =>
      expect(screen.getByText(/Couldn.t load your activities/)).toBeInTheDocument(),
    );
  });
});
