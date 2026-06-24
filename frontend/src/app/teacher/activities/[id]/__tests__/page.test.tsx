import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable navigation state so a single mock drives the real path (classId in
// the URL) and the missing-classId error path.
const nav = vi.hoisted(() => ({
  params: { id: "act-real-123" } as { id: string },
  search: new Map<string, string>(),
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
    // InheritedPersona, which resolves the class persona read-only.
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
    // The editor now renders the full builder body (sim picker + element
    // editors + live preview). Stub the catalogue; the preview tree has its own
    // test, so stub it too (mirrors the create-page test).
    listArtefacts: vi.fn(async () => []),
  };
});

vi.mock("@/components/teacher/ActivityPreview", () => ({
  ActivityPreview: () => <div data-testid="activity-preview" />,
}));

import TeacherActivityConfigPage from "@/app/teacher/activities/[id]/page";
import {
  NotFoundError,
  fetchActivity,
  fetchMyActivityConfig,
  saveActivityConfig,
  updateActivity,
} from "@/lib/teacherApi";

const fetchMock = vi.mocked(fetchActivity);
const saveMock = vi.mocked(updateActivity);
const legacyFetchMock = vi.mocked(fetchMyActivityConfig);
const legacySaveMock = vi.mocked(saveActivityConfig);

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
    expect(screen.getByText(/loading activity/i)).toBeInTheDocument();

    const textarea = (await screen.findByRole("textbox", {
      name: /teaching goal/i,
    })) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Discover component independence");
    expect(fetchMock).toHaveBeenCalledWith("act-real-123");
    expect(screen.getByText(/configure: projectile motion/i)).toBeInTheDocument();
  });

  it("renders an empty form for a not-yet-saved activity (404, no mock)", async () => {
    fetchMock.mockRejectedValueOnce(new NotFoundError());
    render(<TeacherActivityConfigPage />);

    const textarea = (await screen.findByRole("textbox", {
      name: /teaching goal/i,
    })) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  it("surfaces the 3-tab roadmap signals (Parameters / Code / History)", async () => {
    render(<TeacherActivityConfigPage />);
    await screen.findByRole("textbox", { name: /teaching goal/i });
    expect(screen.getByRole("tab", { name: /parameters/i })).toHaveTextContent(/v1\.1/i);
    expect(screen.getByRole("tab", { name: /code/i })).toHaveTextContent(/v2/i);
    expect(screen.getByRole("tab", { name: /history/i })).toHaveTextContent(/v2/i);
  });

  it("saves with the real classId + activityId", async () => {
    render(<TeacherActivityConfigPage />);

    const textarea = (await screen.findByRole("textbox", {
      name: /teaching goal/i,
    })) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "New goal" } });
    fireEvent.click(screen.getByRole("button", { name: /save configuration/i }));

    await waitFor(() => {
      // ALS-1 M0: PATCH /api/activities/{id} — (activityId, body). The body
      // carries the running skill + content; the id is the path param.
      expect(saveMock).toHaveBeenCalledWith(
        "act-real-123",
        expect.objectContaining({ teachingGoal: "New goal" }),
      );
    });
    expect(screen.getByRole("status").textContent ?? "").toMatch(/saved\b/i);
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
      name: /teaching goal/i,
    })) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Discover the optimal angle");
    fireEvent.change(textarea, { target: { value: "Discover the optimal launch angle" } });
    fireEvent.click(screen.getByRole("button", { name: /save configuration/i }));

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
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });

  it("shows the error state (never mock data) when a LEGACY activity arrives without a classId", () => {
    // A legacy (non-act) id resolves from the per-class store, so it needs the
    // classId. (An act- activity is class-independent and loads without one.)
    nav.params = { id: "legacy-skill-uuid" };
    nav.search = new Map(); // no classId
    render(<TeacherActivityConfigPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
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
    const textarea = (await screen.findByRole("textbox", { name: /teaching goal/i })) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Old goal");
    expect(legacyFetchMock).toHaveBeenCalledWith("c-1", "legacy-skill-uuid");
    fireEvent.change(textarea, { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: /save configuration/i }));
    await waitFor(() =>
      expect(legacySaveMock).toHaveBeenCalledWith(
        expect.objectContaining({ activityId: "legacy-skill-uuid", classId: "c-1", teachingGoal: "Edited" }),
      ),
    );
  });
});
