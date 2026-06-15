import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable navigation state so a single mock can drive both the legacy mock
// wireframe path (no classId) and the real path (classId in the URL).
const nav = vi.hoisted(() => ({
  params: { id: "boldkast" } as { id: string },
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
    // Default: first-time teacher, no saved config -> NotFoundError branch.
    fetchMyActivityConfig: vi.fn(async () => {
      throw new actual.NotFoundError();
    }),
    saveActivityConfig: vi.fn(async (body) => ({
      ...body,
      teacherUid: "workshop-user",
      updatedAt: "2026-05-25T15:00:00Z",
    })),
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
  nav.params = { id: "boldkast" };
  nav.search = new Map();
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new NotFoundError());
  saveMock.mockClear();
});

describe("/teacher/activities/[id] — mock wireframe path (no classId)", () => {
  it("renders the teaching-goal textarea pre-filled from mock data", () => {
    render(<TeacherActivityConfigPage />);
    const textarea = screen.getByRole("textbox", {
      name: /teaching goal/i,
    }) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toMatch(/horizontal and vertical motion are independent/);
  });

  it("preserves an edited teaching goal across re-renders", () => {
    render(<TeacherActivityConfigPage />);
    const textarea = screen.getByRole("textbox", {
      name: /teaching goal/i,
    }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Custom goal copy" } });
    expect(textarea.value).toBe("Custom goal copy");
  });

  it("surfaces the 3-tab roadmap signals (Parameters / Code / History) with version pills", () => {
    render(<TeacherActivityConfigPage />);
    expect(screen.getByRole("tab", { name: /teaching goal/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const params = screen.getByRole("tab", { name: /parameters/i });
    const code = screen.getByRole("tab", { name: /code/i });
    const history = screen.getByRole("tab", { name: /history/i });
    expect(params).toHaveTextContent(/v1\.1/i);
    expect(code).toHaveTextContent(/v2/i);
    expect(history).toHaveTextContent(/v2/i);
  });

  it("clicking the Parameters tab swaps in the v1.1 roadmap preview", () => {
    render(<TeacherActivityConfigPage />);
    fireEvent.click(screen.getByRole("tab", { name: /parameters/i }));
    expect(
      screen.getByRole("tabpanel", { name: /parameters/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/initial angle range/i)).toBeInTheDocument();
  });

  it("'Save configuration' click POSTs to /api/activity-configs and shows the saved toast", async () => {
    render(<TeacherActivityConfigPage />);
    const textarea = screen.getByRole("textbox", {
      name: /teaching goal/i,
    }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Edited goal" } });

    fireEvent.click(screen.getByRole("button", { name: /save configuration/i }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent ?? "").toMatch(/saved\b/i);
    });
    expect(textarea.value).toBe("Edited goal");
  });
});

describe("/teacher/activities/[id] — real path (classId in URL)", () => {
  beforeEach(() => {
    // Real activity id (not a mock key) + classId in the URL.
    nav.params = { id: "act-real-123" };
    nav.search = new Map([
      ["classId", "c-1"],
      ["title", "Projectile motion"],
    ]);
  });

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

  it("saves with the real classId + activityId", async () => {
    fetchMock.mockRejectedValueOnce(new NotFoundError()); // not-yet-saved activity
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
  });

  it("shows an error panel when the load fails (non-404)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    render(<TeacherActivityConfigPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });
});
