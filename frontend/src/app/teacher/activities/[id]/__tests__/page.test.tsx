import { fireEvent, render as rtlRender, screen, waitFor, type RenderOptions } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable navigation state so a single mock drives the real path (classId in
// the URL) and the missing-classId error path.
const nav = vi.hoisted(() => ({
  params: { id: "act-real-123" } as { id: string },
  search: new Map<string, string>(),
}));

// 1.1.123 — the editor asks who is looking (owner vs researcher acting for
// them). Default: the owner; one test below flips it.
const authState = { uid: "teacher-1" };
vi.mock("@/hooks/useTeacherAuth", () => ({
  useTeacherAuth: () => ({ user: { uid: authState.uid }, loading: false }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useSearchParams: () => ({ get: (k: string) => nav.search.get(k) ?? null }),
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
    // ALS-1 M0: an act- id loads/saves via the class-independent Activity store.
    fetchActivity: vi.fn(async () => {
      throw new actual.NotFoundError();
    }),
    updateActivity: vi.fn(async (activityId, body) => ({
      ...body,
      activityId,
      ownerUid: "workshop-user",
      updatedAt: "2026-05-25T15:00:00Z",
    })),
    // Legacy path (non-act id) kept mocked for the dual-read test below.
    fetchMyActivityConfig: vi.fn(async () => {
      throw new actual.NotFoundError();
    }),
    saveActivityConfig: vi.fn(async (body) => ({
      ...body,
      teacherUid: "workshop-user",
      updatedAt: "2026-05-25T15:00:00Z",
    })),
    // Persona is class-default-only (1.1.32): the editor renders
    // InheritedTutor, which resolves the class persona read-only.
    fetchPersonaCatalogue: vi.fn(async () => ({
      personas: [
        {
          id: "sofie",
          name: "Sofie",
          title: "Fysikvejleder",
          avatar: "",
          language: "da",
          interactionStyle: "socratic",
          bio: null,
        },
      ],
      defaultId: "sofie",
    })),
    getClass: vi.fn(async (id: string) => ({ classId: id, persona: null })),
    // UI sweep 2026-11-11 — the tutor row reads the activity's ASSIGNMENTS
    // (the classes that run it), not the URL's classId.
    listClasses: vi.fn(async () => []),
    fetchTutorCatalogue: vi.fn(async () => ({ tutors: [], skillBoundTutors: [], frameworks: [] })),
    // The editor now renders the full builder body (sim picker + element
    // editors + live preview). Stub the catalogue; the preview tree has its own
    // test, so stub it too (mirrors the create-page test).
    listArtefacts: vi.fn(async () => []),
  };
});

vi.mock("@/components/teacher/ActivityPreview", () => ({
  ActivityPreview: () => <div data-testid="activity-preview" />,
}));
// The opening editor's mounted controls and preview are covered by
// ActivityBuilderBody.test.tsx. Keep these page tests on load/save wiring.
vi.mock("@/components/teacher/ActivityOpeningEditor", () => ({
  ActivityOpeningEditor: () => <div data-testid="opening-editor" />,
}));

import TeacherActivityConfigPage from "@/app/teacher/activities/[id]/page";
import { Toaster } from "@/components/ui/toast";
import {
  type ClassPayload,
  type TutorCatalogue,
  NotFoundError,
  fetchActivity,
  fetchMyActivityConfig,
  fetchPersonaCatalogue,
  fetchTutorCatalogue,
  listClasses,
  saveActivityConfig,
  updateActivity,
} from "@/lib/teacherApi";

import { LocaleProvider } from "@/i18n";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish, so render inside an English locale (the teacher chose EN).
function EnglishUI({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider locale="en">
      {children}
      <Toaster />
    </LocaleProvider>
  );
}

/** The one Save: a sticky bar at the end of the form (UI sweep 2026-11-12). */
const saveButton = () => screen.getAllByRole("button", { name: /^save$/i })[0];
const render = (ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: EnglishUI, ...options });

const fetchMock = vi.mocked(fetchActivity);
const saveMock = vi.mocked(updateActivity);
const legacyFetchMock = vi.mocked(fetchMyActivityConfig);
const legacySaveMock = vi.mocked(saveActivityConfig);
const listClassesMock = vi.mocked(listClasses);

beforeEach(() => {
  nav.params = { id: "act-real-123" };
  nav.search = new Map([
    ["classId", "c-1"],
    ["title", "Projectile motion"],
  ]);
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new NotFoundError());
  saveMock.mockClear();
  legacyFetchMock.mockReset();
  legacyFetchMock.mockRejectedValue(new NotFoundError());
  legacySaveMock.mockClear();
  listClassesMock.mockReset();
  listClassesMock.mockResolvedValue([]);
});

describe("/teacher/activities/[id] — real activity editor", () => {
  it("loads the live config and pre-fills the goal + cited materials", async () => {
    fetchMock.mockResolvedValueOnce({
      activityId: "act-real-123",
      ownerUid: "teacher-1",
      skillId: "concept",
      visibility: "private",
      classId: "c-1",
      teacherUid: "teacher-1",
      title: "Projectile motion",
      teachingGoal: "Discover component independence",
      language: "da",
      difficulty: "standard",
      pairedWorkbench: null,
      materials: [{ docId: "doc-1", origin: "A-level kinematics" }],
      updatedAt: "2026-06-15T10:00:00Z",
    });

    render(<TeacherActivityConfigPage />);

    // Blocks on the network load first.
    expect(screen.getByRole("status", { name: /loading activity/i })).toBeInTheDocument();

    const textarea = (await screen.findByRole("textbox", {
      name: /what should students learn/i,
    })) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Discover component independence");
    expect(fetchMock).toHaveBeenCalledWith("act-real-123");
    // UI sweep 2026-11-11 — the h1 is the activity's name, no "Configure".
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Projectile motion/);
    expect(screen.queryByText(/configure/i)).toBeNull();
  });

  it("renders an empty form for a not-yet-saved activity (404, no mock)", async () => {
    fetchMock.mockRejectedValueOnce(new NotFoundError());
    render(<TeacherActivityConfigPage />);

    const textarea = (await screen.findByRole("textbox", {
      name: /what should students learn/i,
    })) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  // UI sweep 2026-11-12 — one Save, in the sticky bar at the end of the form;
  // the header keeps Try as student only.
  it("has exactly one Save, inside the form", async () => {
    render(<TeacherActivityConfigPage />);
    await screen.findByRole("textbox", { name: /what should students learn/i });
    const saves = screen.getAllByRole("button", { name: /^save$/i });
    expect(saves).toHaveLength(1);
    expect(saves[0].closest("form")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "You are here" })).toBeInTheDocument();
  });

  // UI sweep 2026-11-11 — the Code tab was a roadmap mock (fake Boldkast
  // source, three fake green checks, an internal note to M/JB) shown to every
  // teacher. It is gone, and so is the tab bar.
  it("has no tab bar and no Code mock", async () => {
    render(<TeacherActivityConfigPage />);
    await screen.findByRole("textbox", { name: /what should students learn/i });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText(/open question/i)).toBeNull();
    expect(screen.queryByText(/boldkast simulation source/i)).toBeNull();
    expect(screen.queryByText(/12[.,]4 KB/)).toBeNull();
    expect(screen.queryByText(/where settings live/i)).toBeNull();
  });

  it("the history line shows adapted-from provenance + lifecycle for an adopted activity", async () => {
    fetchMock.mockResolvedValueOnce({
      activityId: "act-real-123",
      ownerUid: "teacher-1",
      skillId: "concept",
      visibility: "published",
      classId: "",
      teacherUid: "teacher-1",
      title: "Adopted one",
      teachingGoal: "Goal",
      language: "da",
      difficulty: "standard",
      pairedWorkbench: null,
      materials: [],
      sourceActivityId: "act-src",
      sourceOwnerUid: "teacher-other",
      sourceOwnerLabel: "Bob Jensen",
      createdAt: "2026-06-22T09:00:00Z",
      updatedAt: "2026-06-24T10:00:00Z",
    });
    render(<TeacherActivityConfigPage />);
    await screen.findByRole("textbox", { name: /what should students learn/i });

    const line = screen.getByTestId("activity-history");
    expect(line).toHaveTextContent(/Created 22 Jun 2026/);
    expect(line).toHaveTextContent(/Last edited 24 Jun 2026/);
    expect(line).toHaveTextContent(/Shared with colleagues/);
    expect(line).toHaveTextContent(/Adapted from Bob Jensen/);
  });

  it("tells a researcher whose activity they are editing, and the history line says who last edited it (1.1.123)", async () => {
    authState.uid = "researcher-rae";
    fetchMock.mockResolvedValueOnce({
      activityId: "act-real-123",
      ownerUid: "teacher-1",
      ownerLabel: "Bob Jensen",
      skillId: "concept",
      visibility: "private",
      classId: "",
      teacherUid: "teacher-1",
      title: "Bob's",
      teachingGoal: "Goal",
      language: "da",
      difficulty: "standard",
      pairedWorkbench: null,
      materials: [],
      lastEditedBy: { uid: "researcher-rae", at: new Date().toISOString() },
      lastEditedByLabel: "Rae",
      createdAt: "2026-06-22T09:00:00Z",
      updatedAt: "2026-06-24T10:00:00Z",
    });
    try {
      render(<TeacherActivityConfigPage />);
      await screen.findByRole("textbox", { name: /what should students learn/i });
      expect(screen.getByTestId("acting-for-owner-banner")).toHaveTextContent(
        "You are editing Bob Jensen’s activity as a researcher.",
      );
      expect(screen.getByTestId("activity-history")).toHaveTextContent(/Last edited .* by Rae/);
      // A researcher reads across every teacher's classes, or the owner's
      // would never be found for the tutor row.
      await waitFor(() => expect(listClassesMock).toHaveBeenCalledWith("all"));
    } finally {
      authState.uid = "teacher-1";
    }
  });

  it("shows the owner no banner on their own activity", async () => {
    fetchMock.mockResolvedValueOnce({
      activityId: "act-real-123",
      ownerUid: "teacher-1",
      skillId: "concept",
      visibility: "private",
      classId: "",
      teacherUid: "teacher-1",
      title: "Mine",
      teachingGoal: "Goal",
      language: "da",
      difficulty: "standard",
      pairedWorkbench: null,
      materials: [],
      createdAt: "2026-06-22T09:00:00Z",
      updatedAt: "2026-06-24T10:00:00Z",
    });
    render(<TeacherActivityConfigPage />);
    await screen.findByRole("textbox", { name: /what should students learn/i });
    expect(screen.queryByTestId("acting-for-owner-banner")).not.toBeInTheDocument();
  });

  it("the history line shows a from-scratch lifecycle (no provenance) for an original activity", async () => {
    fetchMock.mockResolvedValueOnce({
      activityId: "act-real-123",
      ownerUid: "teacher-1",
      skillId: "concept",
      visibility: "private",
      classId: "",
      teacherUid: "teacher-1",
      title: "Original",
      teachingGoal: "Goal",
      language: "da",
      difficulty: "standard",
      pairedWorkbench: null,
      materials: [],
      sourceActivityId: null,
      sourceOwnerUid: null,
      createdAt: "2026-06-22T09:00:00Z",
      updatedAt: "2026-06-24T10:00:00Z",
    });
    render(<TeacherActivityConfigPage />);
    await screen.findByRole("textbox", { name: /what should students learn/i });

    const line = screen.getByTestId("activity-history");
    expect(line).not.toHaveTextContent(/adapted from/i);
    expect(line).toHaveTextContent(/Private — your classes only/);
  });

  it("saves with the real classId + activityId", async () => {
    render(<TeacherActivityConfigPage />);

    const textarea = (await screen.findByRole("textbox", {
      name: /what should students learn/i,
    })) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "New goal" } });
    fireEvent.click(saveButton());

    await waitFor(() => {
      // ALS-1 M0: PATCH /api/activities/{id} — (activityId, body). The body
      // carries the running skill + content; the id is the path param.
      expect(saveMock).toHaveBeenCalledWith(
        "act-real-123",
        expect.objectContaining({ teachingGoal: "New goal" }),
      );
    });
    expect(await screen.findByText(/^Saved/)).toBeInTheDocument();
  });

  it("round-trips a loaded activity's elements + sim on save (no data loss)", async () => {
    // POST is a full overwrite, so editing the goal must re-send every element
    // and the attached sim — else saving silently wipes them. Load a rich
    // config, tweak the goal, save, and assert the workspace survives.
    fetchMock.mockResolvedValueOnce({
      activityId: "act-real-123",
      ownerUid: "teacher-1",
      skillId: "concept",
      visibility: "private",
      classId: "c-1",
      teacherUid: "teacher-1",
      title: "Kastebevægelse",
      teachingGoal: "Discover the optimal angle",
      language: "da",
      difficulty: "standard",
      pairedWorkbench: null,
      artefactId: "boldkast",
      checklist: [{ id: "step-1", label: "Measure ranges" }],
      table: [
        {
          id: "table-1",
          title: "Forsøg",
          columns: [{ id: "col-1", label: "Vinkel", unit: "°", kind: "number" }],
          rows: 6,
        },
      ],
      note: [{ id: "note-1", title: "Tip", body: "Vary the angle." }],
      materials: [],
      updatedAt: "2026-06-20T10:00:00Z",
    });

    render(<TeacherActivityConfigPage />);
    const textarea = (await screen.findByRole("textbox", {
      name: /what should students learn/i,
    })) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Discover the optimal angle");
    fireEvent.change(textarea, { target: { value: "Discover the optimal launch angle" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const body = saveMock.mock.calls[0][1];
    expect(body.artefactId).toBe("boldkast");
    expect(body.checklist).toEqual([{ id: "step-1", label: "Measure ranges" }]);
    expect(body.table).toEqual([
      {
        id: "table-1",
        title: "Forsøg",
        columns: [{ id: "col-1", label: "Vinkel", unit: "°", kind: "number" }],
        rows: 6,
      },
    ]);
    expect(body.note).toEqual([{ id: "note-1", title: "Tip", body: "Vary the angle." }]);
    expect(body.teachingGoal).toBe("Discover the optimal launch angle");
  });

  it("shows an error panel when the load fails (non-404)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    render(<TeacherActivityConfigPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
  });

  it("shows the error state (never mock data) when a LEGACY activity arrives without a classId", () => {
    // A legacy (non-act) id resolves from the per-class store, so it needs the
    // classId. (An act- activity is class-independent and loads without one.)
    nav.params = { id: "legacy-skill-uuid" };
    nav.search = new Map(); // no classId
    render(<TeacherActivityConfigPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
  });

  it("dual-read: a LEGACY (non-act) id loads + saves via the per-class config store", async () => {
    nav.params = { id: "legacy-skill-uuid" };
    nav.search = new Map([["classId", "c-1"]]);
    legacyFetchMock.mockResolvedValueOnce({
      activityId: "legacy-skill-uuid",
      classId: "c-1",
      teacherUid: "teacher-1",
      title: "Legacy",
      teachingGoal: "Old goal",
      language: "da",
      difficulty: "standard",
      pairedWorkbench: null,
      materials: [],
      updatedAt: "2026-06-20T10:00:00Z",
    });
    render(<TeacherActivityConfigPage />);
    const textarea = (await screen.findByRole("textbox", { name: /what should students learn/i })) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Old goal");
    expect(legacyFetchMock).toHaveBeenCalledWith("c-1", "legacy-skill-uuid");
    fireEvent.change(textarea, { target: { value: "Edited" } });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(legacySaveMock).toHaveBeenCalledWith(
        expect.objectContaining({ activityId: "legacy-skill-uuid", classId: "c-1", teachingGoal: "Edited" }),
      ),
    );
  });
  // UI sweep 2026-11-11 — every link into the editor except the post-create one
  // omitted ?classId=, and with no classId the tutor box said "Default tutor —
  // this class hasn't chosen one yet" even when every class had one.
  it("names the tutor in every class that runs the activity, with no classId in the URL", async () => {
    nav.search = new Map(); // the library's link, which carries no class
    fetchMock.mockResolvedValueOnce({
      activityId: "act-real-123",
      ownerUid: "teacher-1",
      skillId: "concept",
      visibility: "private",
      classId: "",
      teacherUid: "teacher-1",
      title: "Bohr",
      teachingGoal: "Goal",
      language: "da",
      difficulty: "standard",
      pairedWorkbench: null,
      materials: [],
      updatedAt: "2026-06-24T10:00:00Z",
    });
    listClassesMock.mockResolvedValue([
      { classId: "c-7b", name: "2.g Fysik B", activityIds: ["act-real-123"], tutorId: "tu-sofie" },
      { classId: "c-3x", name: "3.x Fysik A", activityIds: ["act-real-123"], tutorId: "tu-niels" },
      { classId: "c-other", name: "Not this one", activityIds: ["act-else"], tutorId: null },
    ] as unknown as ClassPayload[]);
    vi.mocked(fetchPersonaCatalogue).mockResolvedValueOnce({
      personas: [
        { id: "sofie", name: "Sofie", title: null, avatar: "", language: "da", interactionStyle: "socratic", bio: null },
        { id: "niels", name: "Niels", title: null, avatar: "", language: "da", interactionStyle: "rigorous", bio: null },
      ],
      defaultId: "sofie",
      interactionStyles: [],
    });
    vi.mocked(fetchTutorCatalogue).mockResolvedValueOnce({
      tutors: [
        { id: "tu-sofie", personaId: "sofie", frameworkName: "POE" },
        { id: "tu-niels", personaId: "niels", frameworkName: "CER" },
      ],
      skillBoundTutors: [],
      frameworks: [],
    } as unknown as TutorCatalogue);

    render(<TeacherActivityConfigPage />);
    const summary = await screen.findByTestId("class-tutor-summary");
    expect(summary).toHaveTextContent("2.g Fysik B: Sofie (POE) · 3.x Fysik A: Niels (CER)");
    expect(summary).not.toHaveTextContent("Not this one");
    expect(screen.queryByText(/default tutor/i)).toBeNull();
    expect(screen.getByRole("link", { name: "2.g Fysik B" })).toHaveAttribute("href", "/teacher/classes/c-7b");
    // Two classes ⇒ "Change in the class" goes to the class list.
    expect(screen.getByRole("link", { name: "Change in the class" })).toHaveAttribute("href", "/teacher/classes");
  });

  it("says the activity is in no class yet, rather than naming a default", async () => {
    nav.search = new Map();
    render(<TeacherActivityConfigPage />);
    await screen.findByRole("textbox", { name: /what should students learn/i });
    expect(await screen.findByText(/not assigned to a class yet/i)).toBeInTheDocument();
  });

  it("a failed load says so and retries", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    render(<TeacherActivityConfigPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/the activity could not be loaded/i);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("textbox", { name: /what should students learn/i })).toBeInTheDocument();
  });
});
