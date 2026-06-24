import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { ActivityPayload, ClassPayload } from "@/lib/teacherApi";
import TeacherActivitiesPage from "@/app/teacher/activities/page";

function makeActivity(overrides: Partial<ActivityPayload> = {}): ActivityPayload {
  return {
    activityId: "act-energy",
    ownerUid: "t-1",
    skillId: "concept-dialogue",
    visibility: "private",
    classId: "",
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

function makeClass(overrides: Partial<ClassPayload> = {}): ClassPayload {
  return {
    classId: "c-1",
    name: "Physics A — 7B",
    activityIds: [],
    lessons: [],
    ...overrides,
  } as unknown as ClassPayload;
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeacherActivitiesPage (ALS-1 M1.2 library)", () => {
  it("shows an empty state with a New activity link when there are no activities", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue([]);
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    const newLinks = screen.getAllByRole("link", { name: /New activity/ });
    expect(newLinks[0]).toHaveAttribute("href", "/teacher/activities/new");
  });

  it("lists an activity with its assigned-class chips + an Edit link (no classId)", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue([makeActivity()]);
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([
      makeClass({ classId: "c-1", name: "Physics A — 7B", activityIds: ["act-energy"] }),
      makeClass({ classId: "c-2", name: "Physics B — 8A", activityIds: [] }),
    ]);
    render(<TeacherActivitiesPage />);

    await waitFor(() => expect(screen.getByText("Energy basics")).toBeInTheDocument());
    expect(screen.getByText("Concept dialogue")).toBeInTheDocument();
    // Assigned-class chip shows the one class it's assigned to (also appears as an
    // assign checkbox, so allow more than one occurrence).
    expect(screen.getAllByText("Physics A — 7B").length).toBeGreaterThanOrEqual(1);
    // Edit link is class-independent (no classId in the href).
    const editLink = screen.getByRole("link", { name: /Edit/ });
    expect(editLink.getAttribute("href")).toContain("/teacher/activities/act-energy");
    expect(editLink.getAttribute("href")).not.toContain("classId");
  });

  it("assigns the activity to another class via the checkbox", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue([makeActivity()]);
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([
      makeClass({ classId: "c-1", name: "7B", activityIds: [] }),
      makeClass({ classId: "c-2", name: "8A", activityIds: [] }),
    ]);
    const patchMock = vi
      .spyOn(teacherApi, "patchClassActivities")
      .mockResolvedValue(makeClass({ classId: "c-2", name: "8A", activityIds: ["act-energy"] }));
    render(<TeacherActivitiesPage />);

    await screen.findByText("Energy basics");
    // The assign checkboxes are inline now; classes order [7B, 8A] -> index 1 = 8A.
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[1]);
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith("c-2", { add: ["act-energy"] }));
  });

  it("degrades to an error empty-state when the list fails", async () => {
    vi.spyOn(teacherApi, "listActivities").mockRejectedValue(new Error("boom"));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);

    await waitFor(() => expect(screen.getByText(/Couldn.t load your activities/)).toBeInTheDocument());
  });
});
