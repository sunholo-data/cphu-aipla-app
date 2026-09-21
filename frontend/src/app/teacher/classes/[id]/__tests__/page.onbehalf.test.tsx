import { render, screen, waitFor } from "@testing-library/react";
import { type MockedFunction, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { ActivityPayload, ClassPayload } from "@/lib/teacherApi";

const CLASS_ID = "class-bobs";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: CLASS_ID }),
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));
vi.mock("../_ClassAnalyticsCopilot", () => ({ ClassAnalyticsCopilot: () => null }));

// The viewer: a researcher who does NOT own the class.
const authState = { uid: "researcher-rae" };
vi.mock("@/hooks/useTeacherAuth", () => ({
  useTeacherAuth: () => ({ user: { uid: authState.uid }, loading: false }),
}));

import TeacherClassDetailPage from "@/app/teacher/classes/[id]/page";

function bobsClass(overrides: Partial<ClassPayload> = {}): ClassPayload {
  return {
    classId: CLASS_ID,
    ownerUid: "teacher-bob",
    ownerLabel: "Bob",
    name: "Bob's physics",
    description: null,
    tagNamespace: `class:teacher-bob:${CLASS_ID}`,
    lessons: [],
    activityIds: [],
    groupCodes: [],
    revoked: false,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    revokedAt: null,
    ...overrides,
  };
}

function act(id: string, ownerUid: string): ActivityPayload {
  return {
    activityId: id,
    ownerUid,
    skillId: "concept-dialogue",
    visibility: "private",
    classId: "",
    teacherUid: ownerUid,
    title: `Activity ${id}`,
    teachingGoal: "",
    language: "da",
    difficulty: "standard",
    pairedWorkbench: null,
    workbenchType: "none",
    updatedAt: "2026-09-01T00:00:00Z",
  };
}

let listSpy: MockedFunction<typeof teacherApi.listActivities>;

beforeEach(() => {
  vi.spyOn(teacherApi, "getClass").mockResolvedValue(bobsClass());
  listSpy = vi.spyOn(teacherApi, "listActivities") as unknown as MockedFunction<typeof teacherApi.listActivities>;
  // The researcher's OWN library holds only their activity; the scan (scope=all)
  // holds everyone's. The picker must end up showing Bob's, and only Bob's.
  listSpy.mockImplementation(async (scope) => {
    const activities =
      scope === "all"
        ? [act("act-bob", "teacher-bob"), act("act-rae", "researcher-rae"), act("act-other", "teacher-x")]
        : [act("act-rae", "researcher-rae")];
    return { activities, total: activities.length, limit: 200, offset: 0 };
  });
});
afterEach(() => vi.restoreAllMocks());

/**
 * 1.1.123 M0/M2 — a researcher on another teacher's class. Two things must be
 * true that the owner's own page never exercises: the page SAYS whose class it
 * is, and the assign picker offers the OWNER's activities (the backend keys the
 * assign rule on the class owner, so offering the researcher's own would 404).
 */
describe("/teacher/classes/[id] — a researcher acting for the owner", () => {
  it("shows the acting-for banner naming the owner", async () => {
    render(<TeacherClassDetailPage />);
    await waitFor(() => expect(screen.getByTestId("acting-for-owner-banner")).toBeInTheDocument());
    expect(screen.getByTestId("acting-for-owner-banner")).toHaveTextContent("You are editing Bob’s class as a researcher.");
  });

  it("loads the library with scope=all and offers only the owner's activities", async () => {
    render(<TeacherClassDetailPage />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith("all", { limit: 200 }));
    // Open the assign picker.
    const add = await screen.findByRole("button", { name: /add activity/i });
    add.click();
    await waitFor(() => expect(screen.getByText("Activity act-bob")).toBeInTheDocument());
    expect(screen.queryByText("Activity act-rae")).not.toBeInTheDocument();
    expect(screen.queryByText("Activity act-other")).not.toBeInTheDocument();
  });

  it("shows who last edited the class when it was not the owner", async () => {
    vi.spyOn(teacherApi, "getClass").mockResolvedValue(
      bobsClass({ lastEditedBy: { uid: "researcher-rae", at: new Date().toISOString() }, lastEditedByLabel: "Rae" }),
    );
    render(<TeacherClassDetailPage />);
    await waitFor(() => expect(screen.getByTestId("last-edited-line")).toHaveTextContent(/Last edited by Rae/));
  });

  it("keeps the owner's own page unchanged: own-scope library, no banner", async () => {
    authState.uid = "teacher-bob";
    render(<TeacherClassDetailPage />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith("own", { limit: 200 }));
    expect(screen.queryByTestId("acting-for-owner-banner")).not.toBeInTheDocument();
    authState.uid = "researcher-rae";
  });
});
