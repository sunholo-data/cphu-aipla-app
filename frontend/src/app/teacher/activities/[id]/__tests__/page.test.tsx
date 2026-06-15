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
  };
});

import TeacherActivityConfigPage from "@/app/teacher/activities/[id]/page";
import {
  NotFoundError,
  fetchMyActivityConfig,
  saveActivityConfig,
} from "@/lib/teacherApi";

const fetchMock = vi.mocked(fetchMyActivityConfig);
const saveMock = vi.mocked(saveActivityConfig);

beforeEach(() => {
  nav.params = { id: "act-real-123" };
  nav.search = new Map([
    ["classId", "c-1"],
    ["title", "Projectile motion"],
  ]);
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new NotFoundError());
  saveMock.mockClear();
});

describe("/teacher/activities/[id] — real activity editor", () => {
  it("loads the live config and pre-fills the goal + cited materials", async () => {
    fetchMock.mockResolvedValueOnce({
      activityId: "act-real-123",
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
    expect(fetchMock).toHaveBeenCalledWith("c-1", "act-real-123");
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
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          activityId: "act-real-123",
          classId: "c-1",
          teachingGoal: "New goal",
        }),
      );
    });
    expect(screen.getByRole("status").textContent ?? "").toMatch(/saved\b/i);
  });

  it("shows an error panel when the load fails (non-404)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    render(<TeacherActivityConfigPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });

  it("shows the error state (never mock data) when arriving without a classId", () => {
    nav.search = new Map(); // no classId
    render(<TeacherActivityConfigPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
  });
});
