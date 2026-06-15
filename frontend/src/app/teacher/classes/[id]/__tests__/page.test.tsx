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
import type { ClassPayload, SkillSummary } from "@/lib/teacherApi";

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    skillId: "skill-pset",
    name: "problem-set-hints",
    slug: "problem-set-hints",
    displayName: "Problem-set hints (Boldkast)",
    description: "Danish projectile-motion tutor.",
    avatar: "",
    ownerId: "aipla-platform",
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

// Importing after vi.mock so the mocked hook is wired before the page resolves.
import TeacherClassDetailPage from "@/app/teacher/classes/[id]/page";

type GetClassMock = MockedFunction<typeof teacherApi.getClass>;
type MintMock = MockedFunction<typeof teacherApi.mintGroupCodes>;
type ListSkillsMock = MockedFunction<typeof teacherApi.listAccessibleSkills>;
type PatchLessonsMock = MockedFunction<typeof teacherApi.patchLessons>;

let getSpy: GetClassMock;
let mintSpy: MintMock;
let listSkillsSpy: ListSkillsMock;
let patchLessonsSpy: PatchLessonsMock;

beforeEach(() => {
  getSpy = vi.spyOn(teacherApi, "getClass") as unknown as GetClassMock;
  mintSpy = vi.spyOn(teacherApi, "mintGroupCodes") as unknown as MintMock;
  listSkillsSpy = vi.spyOn(teacherApi, "listAccessibleSkills") as unknown as ListSkillsMock;
  patchLessonsSpy = vi.spyOn(teacherApi, "patchLessons") as unknown as PatchLessonsMock;
  // Default: empty catalogue. Individual tests override.
  listSkillsSpy.mockResolvedValue([]);
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
    expect(screen.getByRole("status").textContent ?? "").toMatch(
      /group code fresh-mint-01 created/i,
    );
  });

  it("shows an error banner when the class fails to load", async () => {
    getSpy.mockRejectedValue(new Error("permission denied"));
    render(<TeacherClassDetailPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/permission denied/);
    });
  });

  describe("lessons picker (1.A follow-up)", () => {
    it("renders linked lessons with displayName + description", async () => {
      getSpy.mockResolvedValue(
        makeClassPayload({ lessons: ["skill-pset"] }),
      );
      listSkillsSpy.mockResolvedValue([makeSkill()]);

      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(
          screen.getByText("Problem-set hints (Boldkast)"),
        ).toBeInTheDocument();
      });
      expect(
        screen.getByText("Danish projectile-motion tutor."),
      ).toBeInTheDocument();
    });

    it("'Add lesson' opens the picker showing only un-linked catalogue entries", async () => {
      getSpy.mockResolvedValue(
        makeClassPayload({ lessons: ["skill-pset"] }),
      );
      listSkillsSpy.mockResolvedValue([
        makeSkill(),
        makeSkill({ skillId: "skill-mc", displayName: "Manage classes" }),
      ]);

      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /add from catalogue/i }),
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /add from catalogue/i }));

      // Picker shows only the un-linked entry.
      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: /pick an activity/i }),
        ).toBeInTheDocument();
      });
      // skill-mc is in the picker; skill-pset is NOT (already linked).
      expect(screen.getByText("Manage classes")).toBeInTheDocument();
      // Linked one still appears in the linked list, not in picker.
      const psetMentions = screen.getAllByText("Problem-set hints (Boldkast)");
      expect(psetMentions.length).toBe(1);
    });

    it("picking a lesson calls patchLessons + refreshes the class", async () => {
      getSpy
        .mockResolvedValueOnce(makeClassPayload({ lessons: [] }))
        .mockResolvedValueOnce(makeClassPayload({ lessons: ["skill-pset"] }));
      listSkillsSpy.mockResolvedValue([makeSkill()]);
      patchLessonsSpy.mockResolvedValue(
        makeClassPayload({ lessons: ["skill-pset"] }),
      );

      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /add from catalogue/i }),
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /add from catalogue/i }));

      // Click the lesson row in the picker. The button's accessible
      // name includes the lesson title (displayName + description +
      // "Add" affordance), so match by displayName.
      const pickerRow = await screen.findByRole("button", {
        name: /Problem-set hints \(Boldkast\)/,
      });
      fireEvent.click(pickerRow);

      await waitFor(() => {
        expect(patchLessonsSpy).toHaveBeenCalledWith(CLASS_ID, {
          add: ["skill-pset"],
        });
      });
      // After refresh, lesson appears linked.
      await waitFor(() => {
        const linked = screen.getAllByText("Problem-set hints (Boldkast)");
        expect(linked.length).toBeGreaterThan(0);
      });
    });

    it("Remove on a linked lesson calls patchLessons({remove})", async () => {
      getSpy
        .mockResolvedValueOnce(makeClassPayload({ lessons: ["skill-pset"] }))
        .mockResolvedValueOnce(makeClassPayload({ lessons: [] }));
      listSkillsSpy.mockResolvedValue([makeSkill()]);
      patchLessonsSpy.mockResolvedValue(makeClassPayload({ lessons: [] }));

      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(
          screen.getByText("Problem-set hints (Boldkast)"),
        ).toBeInTheDocument();
      });

      fireEvent.click(
        screen.getByRole("button", {
          name: /remove problem-set hints/i,
        }),
      );

      await waitFor(() => {
        expect(patchLessonsSpy).toHaveBeenCalledWith(CLASS_ID, {
          remove: ["skill-pset"],
        });
      });
    });

    it("Add lesson button is disabled when there are no available skills left", async () => {
      getSpy.mockResolvedValue(
        makeClassPayload({ lessons: ["skill-pset"] }),
      );
      listSkillsSpy.mockResolvedValue([makeSkill()]); // catalogue is the same one already linked

      render(<TeacherClassDetailPage />);
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /add from catalogue/i }),
        ).toBeDisabled();
      });
    });
  });
});
