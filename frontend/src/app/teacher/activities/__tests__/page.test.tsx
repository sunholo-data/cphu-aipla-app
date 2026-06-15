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

  it("names the class each activity belongs to + a workbench badge + Open-class link", async () => {
    vi.spyOn(teacherApi, "listMyActivities").mockResolvedValue([makeActivity()]);
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([
      { classId: "c-1", name: "Physics A — 7B" },
    ] as unknown as teacherApi.ClassPayload[]);
    render(<TeacherActivitiesPage />);

    await waitFor(() => expect(screen.getByText("Energy basics")).toBeInTheDocument());
    expect(screen.getByText("Concept dialogue")).toBeInTheDocument(); // workbenchType=none label
    // The card names the class the activity belongs to (per-class binding is
    // now visible, not hidden) + the listing states the binding explicitly.
    expect(screen.getByText("Physics A — 7B")).toBeInTheDocument();
    expect(screen.getByText(/belongs to the one class/i)).toBeInTheDocument();

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
