import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { ActivityPayload } from "@/lib/teacherApi";
import ResearchActivitiesPage from "@/app/teacher/research/activities/page";

function makeActivity(overrides: Partial<ActivityPayload> = {}): ActivityPayload {
  return {
    activityId: "act-x",
    ownerUid: "R5Z5Y",
    skillId: "concept-dialogue",
    visibility: "published",
    classId: "",
    teacherUid: "R5Z5Y",
    title: "Theirs",
    teachingGoal: "Some goal",
    language: "da",
    difficulty: "standard",
    pairedWorkbench: null,
    workbenchType: "none",
    updatedAt: "2026-06-09T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("ResearchActivitiesPage (1.1.5 cross-teacher research scan)", () => {
  it("renders every teacher's activities read-only, with owner + state + a research banner", async () => {
    const listSpy = vi
      .spyOn(teacherApi, "listActivities")
      .mockResolvedValue([makeActivity({ ownerLabel: "Alice Hansen", title: "Theirs", visibility: "draft" })]);
    render(<ResearchActivitiesPage />);

    await screen.findByText("Theirs");
    expect(listSpy).toHaveBeenCalledWith("all");
    expect(screen.getByText(/Research view/i)).toBeInTheDocument();
    // Friendly owner label, all states labelled (private is no longer blank).
    expect(screen.getByTestId("activity-owner")).toHaveTextContent("Owner: Alice Hansen");
    expect(screen.getByText("Draft")).toBeInTheDocument();
    // Observation only — no edit / assign / delete / status control.
    expect(screen.queryByRole("link", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /visibility/i })).not.toBeInTheDocument();
  });

  it("shows an access-required state when the backend forbids it (403)", async () => {
    vi.spyOn(teacherApi, "listActivities").mockRejectedValue(
      new Error("list activities: 403 researcher access required"),
    );
    render(<ResearchActivitiesPage />);
    expect(await screen.findByText(/researcher access required/i)).toBeInTheDocument();
  });

  it("shows a generic error on a non-403 failure", async () => {
    vi.spyOn(teacherApi, "listActivities").mockRejectedValue(new Error("list activities: 500 boom"));
    render(<ResearchActivitiesPage />);
    expect(await screen.findByText(/couldn.t load activities/i)).toBeInTheDocument();
  });
});
