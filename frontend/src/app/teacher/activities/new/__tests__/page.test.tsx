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
const fetchPersonaListMock = vi.fn();
vi.mock("@/lib/teacherApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teacherApi")>("@/lib/teacherApi");
  return {
    ...actual,
    listClasses: () => listClassesMock(),
    listAccessibleSkills: () => listSkillsMock(),
    saveActivityConfig: (body: unknown) => saveActivityConfigMock(body),
    patchLessons: (classId: string, body: unknown) => patchLessonsMock(classId, body),
    fetchPersonaList: () => fetchPersonaListMock(),
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
    fetchPersonaListMock.mockReset();
    fetchPersonaListMock.mockResolvedValue([]); // no picker by default
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

  it("defaults the teaching style to socratic and sends the chosen style (1.1.20)", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "E" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "g" } });

    const stylePicker = screen.getByLabelText(/teaching style/i) as HTMLSelectElement;
    expect(stylePicker.value).toBe("socratic");
    fireEvent.change(stylePicker, { target: { value: "concise" } });

    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));
    await waitFor(() => expect(saveActivityConfigMock).toHaveBeenCalledTimes(1));
    expect(saveActivityConfigMock.mock.calls[0][0].interactionStyle).toBe("concise");
  });

  it("picking a persona sets its teaching style and records the persona id (1.1.12)", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    fetchPersonaListMock.mockResolvedValue([
      {
        id: "astrid",
        name: "Astrid",
        title: "Senior underviser",
        avatar: "",
        language: "da",
        interactionStyle: "rigorous",
        bio: null,
      },
    ]);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "E" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "g" } });

    // the manual style control is visible while on the "Custom" default…
    expect(screen.getByLabelText(/teaching style/i)).toBeInTheDocument();
    // …picking a named persona OWNS the style, so the manual control disappears
    fireEvent.click(await screen.findByRole("button", { name: /Astrid/ }));
    expect(screen.queryByLabelText(/teaching style/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));
    await waitFor(() => expect(saveActivityConfigMock).toHaveBeenCalledTimes(1));
    const body = saveActivityConfigMock.mock.calls[0][0];
    expect(body.persona).toBe("astrid");
    // the persona's tied style was still recorded internally
    expect(body.interactionStyle).toBe("rigorous");
  });

  it("sends teacher-authored checklist items with positional ids", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "Energi" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "Explore." } });
    // Add two checklist steps.
    fireEvent.click(screen.getByRole("button", { name: /add step/i }));
    fireEvent.click(screen.getByRole("button", { name: /add step/i }));
    fireEvent.change(screen.getByLabelText(/checklist step 1/i), { target: { value: "Identify the system" } });
    fireEvent.change(screen.getByLabelText(/checklist step 2/i), { target: { value: "List transforms" } });
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));

    await waitFor(() => expect(saveActivityConfigMock).toHaveBeenCalledTimes(1));
    expect(saveActivityConfigMock.mock.calls[0][0].checklist).toEqual([
      { id: "step-1", label: "Identify the system" },
      { id: "step-2", label: "List transforms" },
    ]);
  });

  it("drops empty checklist rows on save", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "E" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "g" } });
    fireEvent.click(screen.getByRole("button", { name: /add step/i }));
    // leave it blank
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));
    await waitFor(() => expect(saveActivityConfigMock).toHaveBeenCalledTimes(1));
    expect(saveActivityConfigMock.mock.calls[0][0].checklist).toEqual([]);
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
