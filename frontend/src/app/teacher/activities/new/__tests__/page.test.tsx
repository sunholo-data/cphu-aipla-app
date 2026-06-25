import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({ get: () => null }),
}));

const listClassesMock = vi.fn();
const listSkillsMock = vi.fn();
const createActivityMock = vi.fn();
// Persona is class-default-only (1.1.32): the form renders InheritedPersona,
// which resolves the class persona via fetchPersonaCatalogue + getClass.
const fetchPersonaCatalogueMock = vi.fn();
const getClassMock = vi.fn();
const listArtefactsMock = vi.fn();
vi.mock("@/lib/teacherApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teacherApi")>("@/lib/teacherApi");
  return {
    ...actual,
    listClasses: () => listClassesMock(),
    listAccessibleSkills: () => listSkillsMock(),
    createActivity: (body: unknown) => createActivityMock(body),
    fetchPersonaCatalogue: () => fetchPersonaCatalogueMock(),
    getClass: (id: string) => getClassMock(id),
    listArtefacts: () => listArtefactsMock(),
  };
});

// The live preview mounts the full workspace renderer tree; the page tests
// cover form/save logic, so stub it (ActivityPreview has its own test).
vi.mock("@/components/teacher/ActivityPreview", () => ({
  ActivityPreview: () => <div data-testid="activity-preview" />,
}));

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
    createActivityMock.mockReset();
    listSkillsMock.mockResolvedValue(SKILLS);
    createActivityMock.mockResolvedValue({ activityId: "act-new-1" });
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
    listArtefactsMock.mockReset();
    listArtefactsMock.mockResolvedValue([
      {
        id: "boldkast",
        displayName: "Boldkast",
        description: "Projektil",
        topics: [],
        levels: [],
        language: "da",
        artefactPath: "boldkast/v1",
        status: "live",
      },
    ]);
  });

  it("renders the builder form once classes load", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    expect(await screen.findByLabelText(/activity name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/lesson prompt/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^class$/i)).toBeInTheDocument();
  });

  it("offers an optional vetted simulation picker (1.1.41 — sim is an attachable resource)", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await screen.findByLabelText(/activity name/i);
    // 1.1.41 reverses 1.1.32's "you can't attach a sim" lie — the artefact is now
    // decoupled from the skill, so the builder has a real catalogue picker.
    expect(await screen.findByText("Boldkast")).toBeInTheDocument();
    expect(screen.getByText(/optionally host a vetted simulation/i)).toBeInTheDocument();
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

    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    // ALS-1 M0: creates a NEW activity in the class-independent store. skillId is
    // the resolved concept-dialogue UUID; classId auto-assigns to the class. The
    // backend mints a distinct act- id, so a second create can't overwrite the first.
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: CONCEPT_UUID,
        classId: "c-1",
        title: "Energibevarelse",
        teachingGoal: "Explore energy conservation Socratically.",
      }),
    );
    // No activityId is sent on create — the backend mints it (distinct every time).
    expect(createActivityMock.mock.calls[0][0]).not.toHaveProperty("activityId");
    // Success state replaces the form.
    expect(await screen.findByText(/is live for/i)).toBeInTheDocument();
  });

  it("links the success panel to the MINTED activity id, not the shared skill id", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    createActivityMock.mockResolvedValueOnce({ activityId: "act-aaa" });
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "First" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "g1" } });
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));
    // The configure deep-link carries the minted act- id (the root-cause fix:
    // never the shared concept-dialogue skill id that used to collide).
    await waitFor(() =>
      expect(document.querySelector('a[href*="/teacher/activities/act-aaa"]')).not.toBeNull(),
    );
    expect(document.querySelector(`a[href*="/teacher/activities/${CONCEPT_UUID}"]`)).toBeNull();
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
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    // The activity leaves persona + interaction_style unset so the backend
    // resolves the class default (interaction_style.py inherits the class
    // persona's style when cfg.persona is empty).
    const body = createActivityMock.mock.calls[0][0];
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

    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].checklist).toEqual([
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
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].checklist).toEqual([]);
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

    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].table).toEqual([
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
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].table).toEqual([]);
  });

  it("sends a chart element when the teacher adds one", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "Lab" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "Plot." } });
    fireEvent.click(screen.getByRole("button", { name: /add chart/i }));
    fireEvent.change(screen.getByLabelText(/chart type/i), { target: { value: "line" } });
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));

    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].chart).toEqual([
      { id: "chart-1", title: "", chartKind: "line" },
    ]);
  });

  it("sends a calculator element with its variables + formula", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "Lab" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "Compute." } });
    fireEvent.click(screen.getByRole("button", { name: /add calculator/i }));
    fireEvent.change(screen.getByLabelText(/variable 1 name/i), { target: { value: "s" } });
    fireEvent.change(screen.getByLabelText(/variable 1 label/i), { target: { value: "Strækning" } });
    fireEvent.change(screen.getByLabelText(/^formula$/i), { target: { value: "s * 2" } });
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));

    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].calculator).toEqual([
      { id: "calc-1", title: "", formula: "s * 2", inputs: [{ id: "s", label: "Strækning", unit: "" }] },
    ]);
  });

  it("sends a note element when the teacher writes one", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "Lab" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "Read." } });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));
    fireEvent.change(screen.getByLabelText(/note text/i), { target: { value: "v = s / t" } });
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));

    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].note).toEqual([
      { id: "note-1", title: "", body: "v = s / t" },
    ]);
  });

  it("pre-fills the builder from a template and saves its elements", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await screen.findByLabelText(/activity name/i);
    // Pick the "Beregning" (calculator) template.
    fireEvent.click(screen.getByText("Beregning"));
    expect((screen.getByLabelText(/activity name/i) as HTMLInputElement).value).toBe("Beregn fart");
    expect((screen.getByLabelText(/lesson prompt/i) as HTMLTextAreaElement).value.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    const body = createActivityMock.mock.calls[0][0];
    expect(body.checklist).toHaveLength(3);
    expect(body.calculator).toEqual([
      {
        id: "calc-1",
        title: "Fart",
        formula: "s / t",
        inputs: [
          { id: "s", label: "Strækning", unit: "m" },
          { id: "t", label: "Tid", unit: "s" },
        ],
      },
    ]);
    expect(body.note?.[0]?.title).toBe("Formel");
  });

  it("attaches a simulation picked from the catalogue", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "Lab" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "Explore." } });
    // Pick the Boldkast sim from the catalogue picker.
    fireEvent.click(await screen.findByText("Boldkast"));
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));

    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].artefactId).toBe("boldkast");
  });

  it("defaults a standard activity to workbenchType 'none'", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "E" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "g" } });
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].workbenchType).toBe("none");
  });

  it("adds a document-upload element and saves it with its prompt — composes (1.1.48)", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "Aflever opgave" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "Give feedback." } });
    fireEvent.click(screen.getByRole("button", { name: /add document upload/i }));
    fireEvent.change(screen.getByLabelText(/document prompt/i), { target: { value: "Upload dit arbejde" } });
    // It's an element, not a mode — the workspace tools are still available.
    expect(screen.getByRole("button", { name: /add step/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].document).toEqual([
      { id: "document-1", prompt: "Upload dit arbejde" },
    ]);
  });

  it("pre-fills + saves the solution-writing template (solution editor, standard mode)", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await screen.findByLabelText(/activity name/i);
    fireEvent.click(screen.getByText("Skriv din løsning"));
    expect((screen.getByLabelText(/activity name/i) as HTMLInputElement).value).toBe("Skriv din løsning");
    // The solution prompt is pre-filled in the builder's solution editor.
    expect((screen.getByLabelText(/solution prompt/i) as HTMLTextAreaElement).value.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    const body = createActivityMock.mock.calls[0][0];
    expect(body.solution).toEqual([{ id: "solution-1", prompt: expect.stringContaining("løsning") }]);
    expect(body.workbenchType).toBe("none");
  });

  it("pre-fills + saves the document-feedback template (document element, composes)", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await screen.findByLabelText(/activity name/i);
    fireEvent.click(screen.getByText("Dokumentfeedback"));
    // The document prompt is pre-filled; the workspace tools stay available (element, not mode).
    expect((screen.getByLabelText(/document prompt/i) as HTMLTextAreaElement).value.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /add step/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    const body = createActivityMock.mock.calls[0][0];
    expect(body.document?.[0]?.prompt?.length).toBeGreaterThan(0);
    expect(body.workbenchType).toBe("none");
  });

  it("adds a solution editor element and saves it with its prompt (1.1.45 M4)", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    fireEvent.change(await screen.findByLabelText(/activity name/i), { target: { value: "Aflever" } });
    fireEvent.change(screen.getByLabelText(/lesson prompt/i), { target: { value: "Feedback." } });
    fireEvent.click(screen.getByRole("button", { name: /add solution editor/i }));
    fireEvent.change(screen.getByLabelText(/solution prompt/i), { target: { value: "Skriv din løsning" } });
    fireEvent.click(screen.getByRole("button", { name: /create activity/i }));

    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].solution).toEqual([
      { id: "solution-1", prompt: "Skriv din løsning" },
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
