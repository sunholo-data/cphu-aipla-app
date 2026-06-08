import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({ get: () => null }),
}));

const listClassesMock = vi.fn();
const listSkillsMock = vi.fn();
const saveActivityConfigMock = vi.fn();
const patchLessonsMock = vi.fn();
vi.mock("@/lib/teacherApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teacherApi")>("@/lib/teacherApi");
  return {
    ...actual,
    listClasses: () => listClassesMock(),
    listAccessibleSkills: () => listSkillsMock(),
    saveActivityConfig: (body: unknown) => saveActivityConfigMock(body),
    patchLessons: (classId: string, body: unknown) => patchLessonsMock(classId, body),
  };
});

import NewActivityPage from "@/app/teacher/activities/new/page";

const ONE_CLASS = [{ classId: "c-1", name: "Physics A — 7B" }];
// Platform skills are keyed by a UUID, NOT the name — the builder must
// resolve this id and use it (not "concept-dialogue") on both calls.
const CONCEPT_UUID = "0078a171-concept-uuid";
const SKILLS = [{ skillId: CONCEPT_UUID, name: "concept-dialogue", displayName: "Begrebsdialog" }];

describe("/teacher/activities/new — concept activity builder", () => {
  beforeEach(() => {
    pushMock.mockReset();
    listClassesMock.mockReset();
    listSkillsMock.mockReset();
    saveActivityConfigMock.mockReset();
    patchLessonsMock.mockReset();
    listSkillsMock.mockResolvedValue(SKILLS);
    saveActivityConfigMock.mockResolvedValue({});
    patchLessonsMock.mockResolvedValue({});
  });

  it("renders the builder form once classes load", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    expect(await screen.findByLabelText(/activity name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/lesson prompt/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^class$/i)).toBeInTheDocument();
  });

  it("defaults the workbench to the no-workbench concept type", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    const workbench = (await screen.findByLabelText(/workbench/i)) as HTMLSelectElement;
    expect(workbench.value).toBe("none");
  });

  it("creates a concept-dialogue activity with the entered title + goal", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), {
      target: { value: "Energibevarelse" },
    });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), {
      target: { value: "Explore energy conservation Socratically." },
    });
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));

    await waitFor(() => expect(saveActivityConfigMock).toHaveBeenCalledTimes(1));
    // Uses the resolved skill UUID, NOT the name "concept-dialogue".
    expect(saveActivityConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityId: CONCEPT_UUID,
        classId: "c-1",
        title: "Energibevarelse",
        teachingGoal: "Explore energy conservation Socratically.",
        workbenchType: "none",
        pairedWorkbench: null,
      }),
    );
    // Binds the lesson to the class by its real skill_id so students see it
    // (passing the name 404s the backend lessons PATCH).
    await waitFor(() => expect(patchLessonsMock).toHaveBeenCalledWith("c-1", { add: [CONCEPT_UUID] }));
    // Success state replaces the form.
    expect(await screen.findByText(/is live for/i)).toBeInTheDocument();
  });

  it("blocks submit until a title and a lesson prompt are entered", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    const submit = (await screen.findByRole("button", { name: /create activity/i })) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("shows a create-a-class-first empty state when the teacher has no classes", async () => {
    listClassesMock.mockResolvedValue([]);
    render(<NewActivityPage />);
    expect(await screen.findByText(/create a class first/i)).toBeInTheDocument();
  });

  it("surfaces an error state when classes fail to load", async () => {
    listClassesMock.mockRejectedValue(new Error("boom"));
    render(<NewActivityPage />);
    expect(await screen.findByText(/could not load your classes/i)).toBeInTheDocument();
  });

  it("shows a not-seeded state when the concept-dialogue skill is missing", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    listSkillsMock.mockResolvedValue([]); // catalogue has no concept-dialogue
    render(<NewActivityPage />);
    expect(await screen.findByText(/concept-dialogue tutor isn't available/i)).toBeInTheDocument();
  });
});
