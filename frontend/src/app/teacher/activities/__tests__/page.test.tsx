import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { ActivityPayload, ClassPayload } from "@/lib/teacherApi";
import TeacherActivitiesPage from "@/app/teacher/activities/page";

// The cross-teacher researcher scan moved to its own page (/teacher/research/
// activities); this library page is purely the teacher's own working surface.

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
  vi.spyOn(teacherApi, "listSharedCatalogue").mockResolvedValue({ activities: [], total: [].length, limit: 200, offset: 0 }); // no shared catalogue by default
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeacherActivitiesPage (ALS-1 M1.2 library)", () => {
  it("shows an empty state with a New activity link when there are no activities", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue({ activities: [], total: [].length, limit: 200, offset: 0 });
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    const newLinks = screen.getAllByRole("link", { name: /New activity/ });
    expect(newLinks[0]).toHaveAttribute("href", "/teacher/activities/new");
  });

  it("shows the composition (sim + elements + docs) from the payload", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue({ activities: [
      makeActivity({
        artefactId: "boldkast",
        workbenchType: "app",
        checklist: [{ id: "a", label: "a" }, { id: "b", label: "b" }] as ActivityPayload["checklist"],
        note: [{ id: "n", title: "t", body: "x" }] as unknown as ActivityPayload["note"],
        materials: [{ documentId: "d1" }] as unknown as ActivityPayload["materials"],
      }),
    ], total: [
      makeActivity({
        artefactId: "boldkast",
        workbenchType: "app",
        checklist: [{ id: "a", label: "a" }, { id: "b", label: "b" }] as ActivityPayload["checklist"],
        note: [{ id: "n", title: "t", body: "x" }] as unknown as ActivityPayload["note"],
        materials: [{ documentId: "d1" }] as unknown as ActivityPayload["materials"],
      }),
    ].length, limit: 200, offset: 0 });
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);

    await screen.findByText("Energy basics");
    expect(screen.getByText("Boldkast")).toBeInTheDocument(); // sim artefact, friendly name
    expect(screen.getByText("Checklist 2")).toBeInTheDocument(); // element + count
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("1 document")).toBeInTheDocument();
  });

  it("lists an activity with an Edit link (class-independent) + a chip for its assigned class", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue({ activities: [makeActivity()], total: [makeActivity()].length, limit: 200, offset: 0 });
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([
      makeClass({ classId: "c-1", name: "Physics A — 7B", activityIds: ["act-energy"] }),
      makeClass({ classId: "c-2", name: "Physics B — 8A", activityIds: [] }),
    ]);
    render(<TeacherActivitiesPage />);

    await waitFor(() => expect(screen.getByText("Energy basics")).toBeInTheDocument());
    // The legacy workbench-type badge was dropped; a chat-only activity reads
    // from its (empty) composition row instead.
    expect(screen.queryByText("Concept dialogue")).not.toBeInTheDocument();
    expect(screen.getByText(/Chat only/i)).toBeInTheDocument();
    // The assigned class is a pressed chip-toggle (no separate read-only chip row).
    const assignedChip = screen.getByRole("button", { name: "Physics A — 7B" });
    expect(assignedChip).toHaveAttribute("aria-pressed", "true");
    const editLink = screen.getByRole("link", { name: /Edit/ });
    expect(editLink.getAttribute("href")).toContain("/teacher/activities/act-energy");
    expect(editLink.getAttribute("href")).not.toContain("classId");
  });

  it("assigns the activity to another class via its chip toggle", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue({ activities: [makeActivity()], total: [makeActivity()].length, limit: 200, offset: 0 });
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([
      makeClass({ classId: "c-1", name: "7B", activityIds: [] }),
      makeClass({ classId: "c-2", name: "8A", activityIds: [] }),
    ]);
    const patchMock = vi
      .spyOn(teacherApi, "patchClassActivities")
      .mockResolvedValue(makeClass({ classId: "c-2", name: "8A", activityIds: ["act-energy"] }));
    render(<TeacherActivitiesPage />);

    await screen.findByText("Energy basics");
    const chip8A = screen.getByRole("button", { name: "8A" });
    expect(chip8A).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip8A);
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith("c-2", { add: ["act-energy"] }));
  });

  it("calls listActivities for the OWN library only (no scope=all here)", async () => {
    const listSpy = vi.spyOn(teacherApi, "listActivities").mockResolvedValue({ activities: [makeActivity()], total: [makeActivity()].length, limit: 200, offset: 0 });
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);

    await screen.findByText("Energy basics");
    // The cross-teacher scan lives on /teacher/research/activities now, so this
    // page never requests scope=all and has no My/All toggle.
    // Asserts the SCOPE, not the whole call: 1.1.61 added filter params, and
    // pinning those here would make every future filter change look like a
    // regression in a test about which scope this page requests.
    expect(listSpy).toHaveBeenCalledWith("own", expect.anything());
    expect(listSpy).not.toHaveBeenCalledWith("all", expect.anything());
    expect(screen.queryByRole("button", { name: "All activities" })).not.toBeInTheDocument();
  });

  it("degrades to an error empty-state when the list fails", async () => {
    vi.spyOn(teacherApi, "listActivities").mockRejectedValue(new Error("boom"));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);

    await waitFor(() => expect(screen.getByText(/Couldn.t load activities/)).toBeInTheDocument());
  });
  it("duplicates an activity into the list as a new draft (M2)", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue({ activities: [makeActivity()], total: [makeActivity()].length, limit: 200, offset: 0 });
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    const dupSpy = vi
      .spyOn(teacherApi, "duplicateActivity")
      .mockResolvedValue(makeActivity({ activityId: "act-copy", visibility: "draft" }));
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");
    fireEvent.click(screen.getByRole("button", { name: /Duplicate/ }));
    await waitFor(() => expect(dupSpy).toHaveBeenCalledWith("act-energy"));
    // The copy is prepended -> two cards now carry the title.
    await waitFor(() => expect(screen.getAllByText("Energy basics").length).toBe(2));
  });
  it("toggles an activity's visibility via the status pill (M2)", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue({ activities: [makeActivity()], total: [makeActivity()].length, limit: 200, offset: 0 }); // private
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    const setSpy = vi
      .spyOn(teacherApi, "setActivityVisibility")
      .mockResolvedValue(makeActivity({ visibility: "published" }));
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");
    const pill = screen.getByRole("button", { name: /visibility/i });
    expect(pill).toHaveTextContent("Private");
    fireEvent.click(pill);
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith("act-energy", "published"));
    // The same pill reflects the new state (no separate badge/button).
    await waitFor(() => expect(screen.getByRole("button", { name: /visibility/i })).toHaveTextContent("Shared"));
  });

  it("blocks assignment of a Draft and prompts review & save (not assignable yet)", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue({ activities: [makeActivity({ visibility: "draft" })], total: [makeActivity({ visibility: "draft" })].length, limit: 200, offset: 0 });
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([
      makeClass({ classId: "c-1", name: "7B", activityIds: [] }),
    ]);
    render(<TeacherActivitiesPage />);

    await screen.findByText("Energy basics");
    // A draft offers no class-assignment chip — instead an explicit review prompt.
    expect(screen.queryByRole("button", { name: "7B" })).not.toBeInTheDocument();
    expect(screen.getByText(/review and save/i)).toBeInTheDocument();
    // Draft is read-only: it shows a static badge, not the Private/Shared toggle
    // pill (you can't manually pick Draft, nor share it without reviewing first).
    expect(screen.queryByRole("button", { name: /visibility/i })).not.toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("shows the Shared activities section and adopts a published activity (M3.4)", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue({ activities: [], total: [].length, limit: 200, offset: 0 }); // own library empty
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    vi.spyOn(teacherApi, "listSharedCatalogue").mockResolvedValue({ activities: [
      makeActivity({ activityId: "act-pub", ownerUid: "other", ownerLabel: "Bob Jensen", title: "Shared one", visibility: "published" }),
    ], total: [
      makeActivity({ activityId: "act-pub", ownerUid: "other", ownerLabel: "Bob Jensen", title: "Shared one", visibility: "published" }),
    ].length, limit: 200, offset: 0 });
    const adoptSpy = vi
      .spyOn(teacherApi, "adoptActivity")
      .mockResolvedValue(makeActivity({ activityId: "act-mine", title: "Shared one", visibility: "draft" }));
    render(<TeacherActivitiesPage />);

    await screen.findByText("Shared activities");
    expect(screen.getByText("Bob Jensen")).toBeInTheDocument(); // grouped by owner
    expect(screen.getByText("Shared one")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Use \/ adapt/ }));
    await waitFor(() => expect(adoptSpy).toHaveBeenCalledWith("act-pub"));
    // The adopted draft lands in Your activities (a 2nd "Shared one" appears).
    await waitFor(() => expect(screen.getAllByText("Shared one").length).toBe(2));
  });
});
