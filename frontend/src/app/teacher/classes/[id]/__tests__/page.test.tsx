import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  type MockedFunction,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { ActivityPayload, ClassPayload } from "@/lib/teacherApi";

function makeActivity(overrides: Partial<ActivityPayload> = {}): ActivityPayload {
  return {
    activityId: "act-pset",
    ownerUid: "teacher-1",
    skillId: "concept-dialogue",
    visibility: "private",
    classId: "",
    teacherUid: "teacher-1",
    title: "Problem-set hints (Boldkast)",
    teachingGoal: "Danish projectile-motion tutor.",
    language: "da",
    difficulty: "standard",
    pairedWorkbench: null,
    workbenchType: "none",
    updatedAt: "2026-06-15T00:00:00Z",
    ...overrides,
  };
}

// Inline fixture — the class-detail page is fully real (getClass is mocked
// below); this just supplies a stable id + name for assertions.
const targetClass = { id: "class-7b-physics-a", name: "Physics A — 7B" };
const CLASS_ID = targetClass.id;

function makeClassPayload(overrides: Partial<ClassPayload> = {}): ClassPayload {
  return {
    classId: CLASS_ID,
    ownerUid: "teacher-1",
    name: targetClass.name,
    description: null,
    tagNamespace: `class:teacher-1:${CLASS_ID}`,
    lessons: [],
    activityIds: [],
    groupCodes: ["bright-fox-12", "soft-otter-44"],
    revoked: false,
    createdAt: "2026-05-26T00:00:00Z",
    updatedAt: "2026-05-26T00:00:00Z",
    revokedAt: null,
    ...overrides,
  };
}

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: CLASS_ID }),
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

// The analytics co-pilot has its own tests and pulls in AG-UI + teacher auth;
// stub it so these detail-page tests stay focused on the class surface.
vi.mock("../_ClassAnalyticsCopilot", () => ({ ClassAnalyticsCopilot: () => null }));

// 1.1.123 — the page now asks who is looking (owner vs researcher acting for
// them). These tests are the OWNER's view; page.onbehalf.test.tsx is the other.
vi.mock("@/hooks/useTeacherAuth", () => ({
  useTeacherAuth: () => ({ user: { uid: "teacher-1" }, loading: false }),
}));

// Importing after vi.mock so the mocked hook is wired before the page resolves.
import TeacherClassDetailPage from "@/app/teacher/classes/[id]/page";

type GetClassMock = MockedFunction<typeof teacherApi.getClass>;
type MintMock = MockedFunction<typeof teacherApi.mintGroupCodes>;
type ListActivitiesMock = MockedFunction<typeof teacherApi.listActivities>;
type PatchClassActivitiesMock = MockedFunction<typeof teacherApi.patchClassActivities>;

let getSpy: GetClassMock;
let mintSpy: MintMock;
let listActivitiesSpy: ListActivitiesMock;
let patchActivitiesSpy: PatchClassActivitiesMock;

beforeEach(() => {
  getSpy = vi.spyOn(teacherApi, "getClass") as unknown as GetClassMock;
  mintSpy = vi.spyOn(teacherApi, "mintGroupCodes") as unknown as MintMock;
  listActivitiesSpy = vi.spyOn(teacherApi, "listActivities") as unknown as ListActivitiesMock;
  patchActivitiesSpy = vi.spyOn(teacherApi, "patchClassActivities") as unknown as PatchClassActivitiesMock;
  // Default: empty library. Individual tests override.
  listActivitiesSpy.mockResolvedValue({ activities: [], total: [].length, limit: 200, offset: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/teacher/classes/[id] — class detail", () => {
  it("renders the class name and groups from /api/classes/{id}", async () => {
    getSpy.mockResolvedValue(makeClassPayload());
    render(<TeacherClassDetailPage />);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: targetClass.name }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("bright-fox-12")).toBeInTheDocument();
    expect(screen.getByText("soft-otter-44")).toBeInTheDocument();
  });

  // 2026-08-04: a teacher handed out codes minted on dev and students typed
  // them into test, where every join 401s. A bare code carries no environment;
  // a join link does. Both the address and the per-code link are pinned here.
  describe("join address (environment mix-up)", () => {
    it("states the address students must join at", async () => {
      getSpy.mockResolvedValue(makeClassPayload());
      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: targetClass.name }),
        ).toBeInTheDocument();
      });
      expect(
        screen.getByText(`${window.location.origin}/group`),
      ).toBeInTheDocument();
    });

    it("copies a join link carrying the origin AND the code", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      getSpy.mockResolvedValue(makeClassPayload());
      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: targetClass.name }),
        ).toBeInTheDocument();
      });

      fireEvent.click(
        screen.getAllByRole("button", { name: /copy join link/i })[0],
      );

      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/group?code=bright-fox-12`,
      );
    });
  });

  it("groups voice + language under a 'Class settings' section (P3 consolidation)", async () => {
    getSpy.mockResolvedValue(makeClassPayload());
    render(<TeacherClassDetailPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: targetClass.name })).toBeInTheDocument();
    });
    // The new consolidated section header...
    expect(screen.getByRole("heading", { name: "Class settings" })).toBeInTheDocument();
    // ...still contains the voice panel (VOICE-IN-REC M4 renamed it "Voice &
    // recording" + demoted the raw picker to an Advanced disclosure).
    expect(
      screen.getByRole("heading", { name: /Voice & recording/ }),
    ).toBeInTheDocument();
  });

  it("'New group' click calls mintGroupCodes and refreshes the list", async () => {
    getSpy
      .mockResolvedValueOnce(makeClassPayload({ groupCodes: [] }))
      .mockResolvedValueOnce(makeClassPayload({ groupCodes: ["fresh-mint-01"] }));
    mintSpy.mockResolvedValue({
      classId: CLASS_ID,
      codes: ["fresh-mint-01"],
    });

    render(<TeacherClassDetailPage />);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: targetClass.name }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /new group/i }));

    await waitFor(() => {
      expect(mintSpy).toHaveBeenCalledWith(CLASS_ID, 1);
    });
    await waitFor(() => {
      expect(screen.getByText("fresh-mint-01")).toBeInTheDocument();
    });
    // The page now renders several role="status" live regions (voice panel,
    // empty states, the analytics co-pilot), so scope to the one carrying the
    // mint announcement rather than assuming a single status node.
    const announcements = screen.getAllByRole("status").map((s) => s.textContent ?? "");
    expect(announcements.some((t) => /group code fresh-mint-01 created/i.test(t))).toBe(true);
  });

  describe("revoking a leaked join code (2026-09-29)", () => {
    // The endpoint has existed since the permission model landed and had NO
    // UI, so a teacher whose code got out could only reset the session — which
    // does not stop anyone rejoining with the same code. Found by the
    // check-client-api gate rather than by anyone noticing.

    // The first code in makeClassPayload(); a leaked one is just a code.
    const CODE = "bright-fox-12";

    async function openTheClass() {
      // Each test sets its own class payload — the outer beforeEach only
      // creates the spy, it does not resolve it.
      getSpy.mockResolvedValue(makeClassPayload());
      render(<TeacherClassDetailPage />);
      await waitFor(() => expect(screen.getByRole("heading", { name: targetClass.name })).toBeInTheDocument());
    }

    it("does not revoke on the first click — it asks, and says what will happen", async () => {
      const revokeSpy = vi.spyOn(teacherApi, "revokeGroupCode");
      await openTheClass();

      fireEvent.click(screen.getByLabelText(`Revoke ${CODE}`));

      // ⚠️ Harder than Reset: revoke DELETES the anon_groups doc, so a student
      // mid-lesson fails at their next message and the code can never be
      // reissued. A one-click version of this would be the wrong shape.
      expect(revokeSpy).not.toHaveBeenCalled();
      expect(screen.getByText(/Signs students out now\. Cannot be undone\./)).toBeInTheDocument();
    });

    it("revokes on confirmation and refreshes the list", async () => {
      const revokeSpy = vi
        .spyOn(teacherApi, "revokeGroupCode")
        .mockResolvedValue({ revoked: true, code: CODE, classId: CLASS_ID });
      await openTheClass();

      fireEvent.click(screen.getByLabelText(`Revoke ${CODE}`));
      fireEvent.click(screen.getByRole("button", { name: "Revoke code" }));

      await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith(CLASS_ID, CODE));
    });

    it("says the group's work is kept, because revoke is not erasure", async () => {
      // Erasure is 1.1.80's own thing. A teacher who read "revoke" as "delete
      // everything they did" would avoid using it for exactly the wrong reason.
      vi.spyOn(teacherApi, "revokeGroupCode").mockResolvedValue({
        revoked: true,
        code: CODE,
        classId: CLASS_ID,
      });
      await openTheClass();

      fireEvent.click(screen.getByLabelText(`Revoke ${CODE}`));
      fireEvent.click(screen.getByRole("button", { name: "Revoke code" }));

      await waitFor(() => {
        const announcements = screen.getAllByRole("status").map((n) => n.textContent ?? "");
        expect(announcements.some((t) => /work is kept/i.test(t))).toBe(true);
      });
    });

    it("cancel leaves the code alone", async () => {
      const revokeSpy = vi.spyOn(teacherApi, "revokeGroupCode");
      await openTheClass();

      fireEvent.click(screen.getByLabelText(`Revoke ${CODE}`));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(revokeSpy).not.toHaveBeenCalled();
      expect(screen.getByLabelText(`Revoke ${CODE}`)).toBeInTheDocument();
    });
  });

  it("shows an error banner when the class fails to load", async () => {
    getSpy.mockRejectedValue(new Error("permission denied"));
    render(<TeacherClassDetailPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/permission denied/);
    });
  });

  describe("activities picker (ALS-1 M1.3)", () => {
    it("renders assigned activities with title + teaching goal", async () => {
      getSpy.mockResolvedValue(makeClassPayload({ activityIds: ["act-pset"] }));
      listActivitiesSpy.mockResolvedValue({ activities: [makeActivity()], total: [makeActivity()].length, limit: 200, offset: 0 });

      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(screen.getByText("Problem-set hints (Boldkast)")).toBeInTheDocument();
      });
      expect(screen.getByText("Danish projectile-motion tutor.")).toBeInTheDocument();
    });

    it("'Add activity' opens the picker showing only unassigned library activities", async () => {
      getSpy.mockResolvedValue(makeClassPayload({ activityIds: ["act-pset"] }));
      listActivitiesSpy.mockResolvedValue({ activities: [
        makeActivity(),
        makeActivity({ activityId: "act-energy", title: "Energy basics" }),
      ], total: [
        makeActivity(),
        makeActivity({ activityId: "act-energy", title: "Energy basics" }),
      ].length, limit: 200, offset: 0 });

      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /add activity/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /add activity/i }));

      await waitFor(() => {
        expect(screen.getByRole("region", { name: /pick an activity/i })).toBeInTheDocument();
      });
      // The unassigned one is in the picker; the assigned one is NOT (only in the list).
      expect(screen.getByText("Energy basics")).toBeInTheDocument();
      expect(screen.getAllByText("Problem-set hints (Boldkast)").length).toBe(1);
    });

    it("labels an assigned activity with its title + a class-independent Edit link", async () => {
      getSpy.mockResolvedValue(makeClassPayload({ activityIds: ["act-pset"] }));
      listActivitiesSpy.mockResolvedValue({ activities: [makeActivity({ title: "Mechanical Waves" })], total: [makeActivity({ title: "Mechanical Waves" })].length, limit: 200, offset: 0 });

      render(<TeacherClassDetailPage />);
      await waitFor(() => expect(screen.getByText("Mechanical Waves")).toBeInTheDocument());
      const edit = screen.getByRole("link", { name: /^edit$/i });
      const href = edit.getAttribute("href") ?? "";
      expect(href).toContain("/teacher/activities/act-pset");
      // Class-independent — the edit link no longer carries a classId.
      expect(href).not.toContain("classId");
    });

    it("picking an activity calls patchClassActivities({add}) + refreshes", async () => {
      getSpy
        .mockResolvedValueOnce(makeClassPayload({ activityIds: [] }))
        .mockResolvedValueOnce(makeClassPayload({ activityIds: ["act-pset"] }));
      listActivitiesSpy.mockResolvedValue({ activities: [makeActivity()], total: [makeActivity()].length, limit: 200, offset: 0 });
      patchActivitiesSpy.mockResolvedValue(makeClassPayload({ activityIds: ["act-pset"] }));

      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /add activity/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /add activity/i }));

      const pickerRow = await screen.findByRole("button", { name: /Problem-set hints \(Boldkast\)/ });
      fireEvent.click(pickerRow);

      await waitFor(() => {
        expect(patchActivitiesSpy).toHaveBeenCalledWith(CLASS_ID, { add: ["act-pset"] });
      });
    });

    it("Remove on an assigned activity calls patchClassActivities({remove})", async () => {
      getSpy
        .mockResolvedValueOnce(makeClassPayload({ activityIds: ["act-pset"] }))
        .mockResolvedValueOnce(makeClassPayload({ activityIds: [] }));
      listActivitiesSpy.mockResolvedValue({ activities: [makeActivity()], total: [makeActivity()].length, limit: 200, offset: 0 });
      patchActivitiesSpy.mockResolvedValue(makeClassPayload({ activityIds: [] }));

      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(screen.getByText("Problem-set hints (Boldkast)")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /remove problem-set hints/i }));

      await waitFor(() => {
        expect(patchActivitiesSpy).toHaveBeenCalledWith(CLASS_ID, { remove: ["act-pset"] });
      });
    });

    it("'Add activity' is disabled when every library activity is already assigned", async () => {
      getSpy.mockResolvedValue(makeClassPayload({ activityIds: ["act-pset"] }));
      listActivitiesSpy.mockResolvedValue({ activities: [makeActivity()], total: [makeActivity()].length, limit: 200, offset: 0 }); // the only library activity is assigned

      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /add activity/i })).toBeDisabled();
      });
    });
  });
});

// 1.1.137 — the class list on the real page. The component test proves the
// sheet itself; this proves the PAGE does not pick a name up on the way (a
// refresh, a mint, an analytics call) while the teacher types one.
describe("/teacher/classes/[id] — class list stays on the device", () => {
  it("typing a name on the page sends it nowhere", async () => {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    // Records every request the page makes; fails them like an offline
    // network so neighbouring panels take their error path, not a fake body.
    const fetchSpy = vi.fn(async (..._args: unknown[]) => {
      throw new TypeError("offline (test)");
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      getSpy.mockResolvedValue(makeClassPayload());
      mintSpy.mockResolvedValue({ codes: ["new-code-1"] } as unknown as Awaited<
        ReturnType<typeof teacherApi.mintGroupCodes>
      >);
      render(<TeacherClassDetailPage />);
      fireEvent.click(await screen.findByRole("button", { name: /^Class list/, expanded: false }));
      fireEvent.change(await screen.findByLabelText("Names for bright-fox-12"), {
        target: { value: "Zelda Privatperson" },
      });
      fireEvent.click(screen.getByRole("button", { name: /new group/i }));
      await waitFor(() => expect(mintSpy).toHaveBeenCalled());

      expect(store.get("aipla.classlist.class-7b-physics-a")).toContain("Zelda Privatperson");
      const sent = JSON.stringify([
        fetchSpy.mock.calls,
        getSpy.mock.calls,
        mintSpy.mock.calls,
        listActivitiesSpy.mock.calls,
        patchActivitiesSpy.mock.calls,
      ]);
      expect(sent).not.toContain("Zelda");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
