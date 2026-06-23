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
// Persona is class-default-only (1.1.32): the form renders InheritedPersona,
// which resolves the class persona via fetchPersonaCatalogue + getClass.
const fetchPersonaCatalogueMock = vi.fn();
const getClassMock = vi.fn();
vi.mock("@/lib/teacherApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teacherApi")>("@/lib/teacherApi");
  return {
    ...actual,
    listClasses: () => listClassesMock(),
    listAccessibleSkills: () => listSkillsMock(),
    saveActivityConfig: (body: unknown) => saveActivityConfigMock(body),
    patchLessons: (classId: string, body: unknown) => patchLessonsMock(classId, body),
    fetchPersonaCatalogue: () => fetchPersonaCatalogueMock(),
    getClass: (id: string) => getClassMock(id),
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
    fetchPersonaCatalogueMock.mockReset();
    getClassMock.mockReset();
    // Default: the class inherits the global default persona (Sofie).
    fetchPersonaCatalogueMock.mockResolvedValue({
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
    });
    getClassMock.mockResolvedValue({ classId: "c-1", persona: null });
  });

  it("renders the builder form once classes load", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    expect(await screen.findByLabelText(/activity name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/lesson prompt/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^class$/i)).toBeInTheDocument();
  });

  it("states honestly that this is a chat-only concept activity (1.1.32 — no decoupled sim knob)", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await screen.findByLabelText(/activity name/i);
    // The lying "Paired workbench" picker was removed; the form now explains
    // that simulators are their own activities.
    expect(screen.getByText(/chat-only concept activity/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/workbench/i)).not.toBeInTheDocument();
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
      }),
    );
    // Binds the lesson to the class by its real skill_id so students see it
    // (passing the name 404s the backend lessons PATCH).
    await waitFor(() => expect(patchLessonsMock).toHaveBeenCalledWith("c-1", { add: [CONCEPT_UUID] }));
    // Success state replaces the form.
    expect(await screen.findByText(/is live for/i)).toBeInTheDocument();
  });

  it("shows the inherited class persona read-only and never writes persona/style (1.1.32 — class-default-only)", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "E" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "g" } });

    // The persona is shown read-only (resolved from the class default) — there
    // is NO co-equal picker and NO standalone teaching-style control anymore.
    expect(await screen.findByText("Sofie")).toBeInTheDocument();
    expect(screen.getByText(/change in class settings/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/teaching style/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Custom$/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));
    await waitFor(() => expect(saveActivityConfigMock).toHaveBeenCalledTimes(1));
    // The activity leaves persona + interaction_style unset so the backend
    // resolves the class default (interaction_style.py inherits the class
    // persona's style when cfg.persona is empty).
    const body = saveActivityConfigMock.mock.calls[0][0];
    expect(body).not.toHaveProperty("persona");
    expect(body).not.toHaveProperty("interactionStyle");
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

  it("sends a teacher-authored data table with positional column ids", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "Lab" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "Measure." } });
    // Add a data table + name its first (seeded) column.
    fireEvent.click(screen.getByRole("button", { name: /add data table/i }));
    fireEvent.change(screen.getByLabelText(/column 1 label/i), { target: { value: "Tid" } });
    fireEvent.change(screen.getByLabelText(/column 1 unit/i), { target: { value: "s" } });
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));

    await waitFor(() => expect(saveActivityConfigMock).toHaveBeenCalledTimes(1));
    expect(saveActivityConfigMock.mock.calls[0][0].table).toEqual([
      {
        id: "table-1",
        title: "",
        columns: [{ id: "col-1", label: "Tid", unit: "s", kind: "number" }],
        rows: 5,
      },
    ]);
  });

  it("drops a data table with no labelled columns on save", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "E" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "g" } });
    fireEvent.click(screen.getByRole("button", { name: /add data table/i }));
    // leave the seeded column blank → the table is dropped
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));
    await waitFor(() => expect(saveActivityConfigMock).toHaveBeenCalledTimes(1));
    expect(saveActivityConfigMock.mock.calls[0][0].table).toEqual([]);
  });

  it("sends a chart element when the teacher adds one", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "Lab" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "Plot." } });
    fireEvent.click(screen.getByRole("button", { name: /add chart/i }));
    fireEvent.change(screen.getByLabelText(/chart type/i), { target: { value: "line" } });
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));

    await waitFor(() => expect(saveActivityConfigMock).toHaveBeenCalledTimes(1));
    expect(saveActivityConfigMock.mock.calls[0][0].chart).toEqual([
      { id: "chart-1", title: "", chartKind: "line" },
    ]);
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
