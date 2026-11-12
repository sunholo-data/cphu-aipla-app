import { fireEvent, render as rtlRender, screen, waitFor, within, type RenderOptions } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The wizard keeps its step in the URL (`?step=`), so it needs a router whose
// push actually changes what useSearchParams returns.
vi.mock("next/navigation", async () => (await import("@/test/nextNavigationMock")).navigationModule);
import { nav } from "@/test/nextNavigationMock";

const listClassesMock = vi.fn();
const listSkillsMock = vi.fn();
const createActivityMock = vi.fn();
const setVisibilityMock = vi.fn();
// Persona is class-default-only (1.1.32): the review step renders the class
// tutor, which resolves the class persona via fetchPersonaCatalogue.
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
    setActivityVisibility: (id: string, v: string) => setVisibilityMock(id, v),
    fetchPersonaCatalogue: () => fetchPersonaCatalogueMock(),
    fetchTutorCatalogue: () => Promise.resolve({ tutors: [], skillBoundTutors: [] }),
    getClass: (id: string) => getClassMock(id),
    listArtefacts: () => listArtefactsMock(),
  };
});

// The live preview mounts the full workspace renderer tree; these tests cover
// the wizard and its save, so stub it (ActivityPreview has its own test).
vi.mock("@/components/teacher/ActivityPreview", () => ({
  ActivityPreview: () => <div data-testid="activity-preview" />,
}));
// The opening editor and Materials have their own tests; here they only need
// to be reachable from "More settings".
vi.mock("@/components/teacher/ActivityOpeningEditor", () => ({
  ActivityOpeningEditor: () => <div data-testid="opening-editor" />,
}));
vi.mock("@/components/teacher/MaterialsSection", () => ({
  MaterialsSection: () => <div data-testid="materials-section" />,
}));

import NewActivityPage from "@/app/teacher/activities/new/page";
import { resetSimCatalogue } from "@/components/teacher/useSimCatalogue";
import { Toaster } from "@/components/ui/toast";
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
const render = (ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: EnglishUI, ...options });

const ONE_CLASS = [{ classId: "c-1", name: "Physics A — 7B" }];
const TWO_CLASSES = [
  { classId: "c-1", name: "Physics A — 7B" },
  { classId: "c-2", name: "2.x English stream", voice: { language: "en", voice: null, provider: null } },
];
// Platform skills are keyed by a UUID, NOT the name — the wizard must
// resolve this id and use it (not "concept-dialogue").
const CONCEPT_UUID = "0078a171-concept-uuid";
const SKILLS = [{ skillId: CONCEPT_UUID, name: "concept-dialogue", displayName: "Begrebsdialog" }];

const goalField = () => screen.getByLabelText(/what should the students learn/i) as HTMLTextAreaElement;
const nameField = () => screen.getByLabelText(/^name$/i) as HTMLInputElement;
const nextButton = () => screen.getByRole("button", { name: /next: tools/i }) as HTMLButtonElement;

async function fillStep1(goal = "Explore energy conservation.", name = "Energibevarelse") {
  fireEvent.change(await screen.findByLabelText(/what should the students learn/i), { target: { value: goal } });
  fireEvent.change(nameField(), { target: { value: name } });
}

/** Step 1 → step 2. */
async function toTools(goal?: string, name?: string) {
  await fillStep1(goal, name);
  fireEvent.click(nextButton());
  await screen.findByRole("heading", { name: /what will the students work with/i });
}

/** Step 2 → step 3. */
async function toReview() {
  fireEvent.click(screen.getByRole("button", { name: /next: check and start/i }));
  await screen.findByRole("heading", { name: /check and start/i });
}

const createButton = () => screen.getByRole("button", { name: /create and give to/i }) as HTMLButtonElement;

describe("/teacher/activities/new — the three-step wizard", () => {
  beforeEach(() => {
    nav.reset("/teacher/activities/new");
    resetSimCatalogue();
    listClassesMock.mockReset();
    listSkillsMock.mockReset();
    createActivityMock.mockReset();
    setVisibilityMock.mockReset();
    listSkillsMock.mockResolvedValue(SKILLS);
    createActivityMock.mockResolvedValue({ activityId: "act-new-1" });
    setVisibilityMock.mockResolvedValue({});
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

  // ── Step 1 ────────────────────────────────────────────────────────────────

  it("opens on the goal, for the class it came from, with the stepper on step 1", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    expect(await screen.findByRole("heading", { level: 1, name: /what should the students learn/i })).toBeInTheDocument();
    expect(screen.getByText("Physics A — 7B")).toBeInTheDocument();
    // One class: nothing to switch to.
    expect(screen.queryByRole("button", { name: /change class/i })).toBeNull();
    const steps = screen.getByRole("navigation", { name: /steps/i });
    expect(within(steps).getByText("Goal").closest("[aria-current]")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    // Four examples, one per lesson shape, and the full picker behind "See all".
    expect(within(screen.getByRole("list", { name: /examples/i })).getAllByRole("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /see all \d+/i })).toBeInTheDocument();
  });

  it("pre-selects ?classId and lets the teacher change the class", async () => {
    nav.reset("/teacher/activities/new", "classId=c-2");
    listClassesMock.mockResolvedValue(TWO_CLASSES);
    render(<NewActivityPage />);
    expect(await screen.findByText("2.x English stream")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /change class/i }));
    fireEvent.change(screen.getByLabelText(/^class$/i), { target: { value: "c-1" } });
    expect(screen.getByText("Physics A — 7B")).toBeInTheDocument();
  });

  it("seeds the goal from the after-lesson review's brief, and suggests a name (1.1.139 M3)", async () => {
    nav.reset("/teacher/activities/new", "brief=start%20next%20lesson%20on%20frequency.%20Then%20waves.");
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    expect(await screen.findByLabelText(/what should the students learn/i)).toHaveValue(
      "start next lesson on frequency. Then waves.",
    );
    expect(nameField()).toHaveValue("Start next lesson on frequency");
    expect(screen.getByText(/suggested from the goal/i)).toBeInTheDocument();
  });

  it("gates Next on a goal and a name, suggesting the name and never overwriting a typed one", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await screen.findByLabelText(/what should the students learn/i);
    expect(nextButton().disabled).toBe(true);
    expect(screen.getByText(/write a goal and a name to continue/i)).toBeInTheDocument();

    // The name follows the goal while the teacher has not typed one…
    fireEvent.change(goalField(), { target: { value: "Students should understand why energy is conserved" } });
    expect(nameField()).toHaveValue("Energy is conserved");
    expect(nextButton().disabled).toBe(false);
    fireEvent.change(goalField(), { target: { value: "Energy is conserved on a roller coaster, always" } });
    expect(nameField()).toHaveValue("Energy is conserved on a roller");

    // …and stops the moment they do.
    fireEvent.change(nameField(), { target: { value: "My roller coaster" } });
    fireEvent.change(goalField(), { target: { value: "Something else entirely" } });
    expect(nameField()).toHaveValue("My roller coaster");

    // No goal, no Next — even with a name.
    fireEvent.change(goalField(), { target: { value: "" } });
    expect(nextButton().disabled).toBe(true);
  });

  // ── The step in the URL ───────────────────────────────────────────────────

  it("keeps the step in the URL with history entries, so Back steps back", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await toTools();
    expect(nav.push).toHaveBeenLastCalledWith("/teacher/activities/new?step=2", { scroll: false });
    expect(nav.search.get("step")).toBe("2");
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();

    await toReview();
    expect(nav.search.get("step")).toBe("3");

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(await screen.findByRole("heading", { name: /what will the students work with/i })).toBeInTheDocument();
    expect(nav.search.get("step")).toBe("2");

    // The stepper's done step is a way back too.
    fireEvent.click(within(screen.getByRole("navigation", { name: /steps/i })).getByRole("button", { name: /goal/i }));
    expect(await screen.findByLabelText(/what should the students learn/i)).toHaveValue("Explore energy conservation.");
    expect(nav.search.get("step")).toBeNull();
  });

  it("lands a ?step=3 link with an empty draft on step 1", async () => {
    nav.reset("/teacher/activities/new", "step=3");
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    expect(await screen.findByRole("heading", { level: 1, name: /what should the students learn/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create and give to/i })).toBeNull();
  });

  // ── Step 2 ────────────────────────────────────────────────────────────────

  it("toggles a tool on and off from its tile, with Undo after removing", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await toTools();
    const tile = screen.getByTestId("workspace-tile-checklist");
    expect(tile).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "true");
    const selected = screen.getByRole("region", { name: /selected/i });
    expect(within(selected).getByTestId("workspace-card-checklist")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/checklist step 1/i), { target: { value: "Identify the system" } });

    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("workspace-card-checklist")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("workspace-card-checklist")).toBeInTheDocument();
  });

  it("offers every workspace kind as a short tile, with the sim count", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await toTools();
    for (const kind of ["sim", "checklist", "table", "chart", "calculator", "note", "writing", "solution", "document"]) {
      expect(screen.getByTestId(`workspace-tile-${kind}`)).toBeInTheDocument();
    }
    expect(await screen.findByText("The tested simulation from the library")).toBeInTheDocument();
    // ≤ 8 words of help on every tile; no formula syntax.
    for (const tile of screen.getAllByTestId(/^workspace-tile-/)) {
      const help = tile.querySelector("span.text-xs")?.textContent ?? "";
      expect(help.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(8);
      expect(help).not.toMatch(/[=*^]/);
    }
  });

  it("attaches a simulation picked from the catalogue", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await toTools();
    fireEvent.click(screen.getByTestId("workspace-tile-sim"));
    fireEvent.click(await screen.findByText("Boldkast"));
    expect(screen.getByTestId("workspace-tile-sim")).toHaveAttribute("aria-pressed", "true");
    await toReview();
    fireEvent.click(createButton());
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0].artefactId).toBe("boldkast");
  });

  // ── Step 3 and the create ─────────────────────────────────────────────────

  it("creates the activity with what the steps collected, then goes to its editor", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await toTools("Explore energy conservation Socratically.", "Energibevarelse");
    fireEvent.click(screen.getByTestId("workspace-tile-checklist"));
    fireEvent.click(screen.getByRole("button", { name: /add step/i }));
    fireEvent.change(screen.getByLabelText(/checklist step 1/i), { target: { value: "Identify the system" } });
    fireEvent.change(screen.getByLabelText(/checklist step 2/i), { target: { value: "List transforms" } });
    fireEvent.click(screen.getByTestId("workspace-tile-table"));
    fireEvent.change(screen.getByLabelText(/column 1 label/i), { target: { value: "Tid" } });
    fireEvent.change(screen.getByLabelText(/column 1 unit/i), { target: { value: "s" } });
    await toReview();

    const summary = screen.getByTestId("wizard-summary");
    expect(within(summary).getByText("Energibevarelse")).toBeInTheDocument();
    expect(within(summary).getByText("Checklist, Data table")).toBeInTheDocument();
    expect(createButton()).toHaveTextContent("Create and give to Physics A — 7B");

    fireEvent.click(createButton());
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    const body = createActivityMock.mock.calls[0][0];
    // ALS-1 M0: the resolved concept-dialogue UUID, the class it is given to,
    // and no activityId (the backend mints a distinct act- id every time).
    expect(body).toEqual(
      expect.objectContaining({
        skillId: CONCEPT_UUID,
        classId: "c-1",
        title: "Energibevarelse",
        teachingGoal: "Explore energy conservation Socratically.",
        workbenchType: "none",
      }),
    );
    expect(body).not.toHaveProperty("activityId");
    // The class tutor teaches: the activity never writes persona or style.
    expect(body).not.toHaveProperty("persona");
    expect(body).not.toHaveProperty("interactionStyle");
    expect(body.checklist).toEqual([
      { id: "step-1", label: "Identify the system" },
      { id: "step-2", label: "List transforms" },
    ]);
    expect(body.table).toEqual([
      {
        id: expect.stringMatching(/^table-k\d+$/),
        title: "",
        columns: [{ id: expect.stringMatching(/^col-k\d+$/), label: "Tid", unit: "s", kind: "number" }],
        rows: 5,
      },
    ]);
    // Not shared unless asked.
    expect(setVisibilityMock).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(nav.push).toHaveBeenLastCalledWith("/teacher/activities/act-new-1?classId=c-1&title=Energibevarelse"),
    );
    // Toasts are a page-global store, so an earlier test's toast may still show.
    expect((await screen.findAllByText(/is created and live for Physics A — 7B/i)).length).toBeGreaterThan(0);
    const another = screen.getAllByRole("button", { name: "Create another" });
    fireEvent.click(another[another.length - 1]);
    expect(nav.push).toHaveBeenLastCalledWith("/teacher/activities/new?classId=c-1");
  });

  it("names the class tutor on the review, with the way to change it", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await toTools();
    await toReview();
    expect(await screen.findByText(/Sofie/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /change in the class/i })).toHaveAttribute("href", "/teacher/classes/c-1");
    // "Edit" jumps back to the step it names.
    fireEvent.click(screen.getByRole("button", { name: /edit tools/i }));
    expect(await screen.findByRole("heading", { name: /what will the students work with/i })).toBeInTheDocument();
  });

  it("shares with colleagues after creating when the box is ticked", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await toTools();
    await toReview();
    fireEvent.click(screen.getByLabelText(/also share with colleagues/i));
    fireEvent.click(createButton());
    await waitFor(() => expect(setVisibilityMock).toHaveBeenCalledWith("act-new-1", "published"));
    expect(createActivityMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(nav.push).toHaveBeenLastCalledWith(expect.stringContaining("/teacher/activities/act-new-1?")));
  });

  it("keeps the created activity when sharing fails, and says so", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    setVisibilityMock.mockRejectedValue(new Error("403"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<NewActivityPage />);
    await toTools();
    await toReview();
    fireEvent.click(screen.getByLabelText(/also share with colleagues/i));
    fireEvent.click(createButton());
    expect(await screen.findByText(/was created, but it could not be shared/i)).toBeInTheDocument();
    // Not rolled back: still the success toast and the editor.
    expect((await screen.findAllByText(/is created and live for/i)).length).toBeGreaterThan(0);
    await waitFor(() => expect(nav.push).toHaveBeenLastCalledWith(expect.stringContaining("/teacher/activities/act-new-1?")));
  });

  it("shows the create failure on the review and stays there", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    createActivityMock.mockRejectedValue(new Error("500"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<NewActivityPage />);
    await toTools();
    await toReview();
    fireEvent.click(createButton());
    expect(await screen.findByText(/could not create the activity/i)).toHaveAttribute("role", "alert");
    expect(setVisibilityMock).not.toHaveBeenCalled();
    expect(createButton().disabled).toBe(false);
  });

  it("opens every default behind More settings, in place", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await toTools();
    await toReview();
    expect(screen.queryByLabelText(/^language$/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /more settings/i }));

    fireEvent.click(screen.getByRole("button", { name: "Change: Student view" }));
    fireEvent.click(screen.getByLabelText(/work first/i));
    fireEvent.click(screen.getByRole("button", { name: "Change: Students see first" }));
    expect(screen.getByTestId("opening-editor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change: Materials" }));
    expect(screen.getByTestId("materials-section")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change: Notes for the tutor" }));
    fireEvent.change(screen.getByRole("textbox", { name: /notes for the tutor/i }), {
      target: { value: "Push on units." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change: Language" }));
    fireEvent.change(screen.getByLabelText(/^language$/i), { target: { value: "en" } });

    fireEvent.click(createButton());
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    const body = createActivityMock.mock.calls[0][0];
    expect(body.studentView).toBe("workbench");
    expect(body.tutorNotes).toBe("Push on units.");
    expect(body.language).toBe("en");
  });

  // ── The students' language ────────────────────────────────────────────────

  it("defaults the students' language to the class's, and follows a class switch", async () => {
    nav.reset("/teacher/activities/new", "classId=c-2");
    listClassesMock.mockResolvedValue(TWO_CLASSES);
    render(<NewActivityPage />);
    await screen.findByText("2.x English stream");
    fireEvent.change(goalField(), { target: { value: "Explore." } });
    fireEvent.change(nameField(), { target: { value: "E" } });
    fireEvent.click(nextButton());
    await toReview();
    fireEvent.click(createButton());
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0]).toEqual(expect.objectContaining({ classId: "c-2", language: "en" }));
  });

  it("switches back to Danish for a class with no language of its own", async () => {
    nav.reset("/teacher/activities/new", "classId=c-2");
    listClassesMock.mockResolvedValue(TWO_CLASSES);
    render(<NewActivityPage />);
    await screen.findByText("2.x English stream");
    fireEvent.click(screen.getByRole("button", { name: /change class/i }));
    fireEvent.change(screen.getByLabelText(/^class$/i), { target: { value: "c-1" } });
    await toTools();
    await toReview();
    fireEvent.click(createButton());
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    expect(createActivityMock.mock.calls[0][0]).toEqual(expect.objectContaining({ classId: "c-1", language: "da" }));
  });

  // ── Templates ─────────────────────────────────────────────────────────────

  it("fills the goal, name and tools from a template, without switching the language", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await screen.findByLabelText(/what should the students learn/i);
    fireEvent.click(screen.getByRole("button", { name: /see all \d+/i }));
    fireEvent.click(screen.getByText("The four-stroke engine — why higher compression? (English)"));
    expect(nameField()).toHaveValue("The four-stroke engine");
    expect(goalField().value.length).toBeGreaterThan(0);
    // The template's name is not a suggestion to be replaced by the goal.
    expect(screen.queryByText(/suggested from the goal/i)).toBeNull();

    fireEvent.click(nextButton());
    await screen.findByRole("heading", { name: /what will the students work with/i });
    expect(screen.getByTestId("workspace-tile-sim")).toHaveAttribute("aria-pressed", "true");
    await toReview();
    fireEvent.click(createButton());
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    // An English template in a Danish class keeps the class's Danish.
    expect(createActivityMock.mock.calls[0][0].language).toBe("da");
  });

  it("saves a template's elements (calculator template)", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    render(<NewActivityPage />);
    await screen.findByLabelText(/what should the students learn/i);
    fireEvent.click(screen.getByRole("button", { name: /see all \d+/i }));
    fireEvent.click(screen.getByText("Fart, tid og strækning"));
    expect(nameField()).toHaveValue("Beregn fart");
    fireEvent.click(nextButton());
    await toReview();
    fireEvent.click(createButton());
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
  });

  // UI sweep 2026-11-11 — applying a template overwrites the name, the goal
  // and every element; it used to do so silently.
  it("asks before a template replaces what the teacher typed, and keeps it on No", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<NewActivityPage />);
      await screen.findByLabelText(/what should the students learn/i);
      fireEvent.change(nameField(), { target: { value: "Mine" } });
      fireEvent.click(screen.getByRole("button", { name: /see all \d+/i }));
      fireEvent.click(screen.getByText("Fart, tid og strækning"));
      await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
      expect(nameField()).toHaveValue("Mine");

      confirmSpy.mockReturnValue(true);
      fireEvent.click(screen.getByText("Fart, tid og strækning"));
      await waitFor(() => expect(nameField()).toHaveValue("Beregn fart"));
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("does not ask when the form is untouched, nor when switching between examples", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<NewActivityPage />);
      await screen.findByLabelText(/what should the students learn/i);
      const [first, second] = within(screen.getByRole("list", { name: /examples/i })).getAllByRole("button");
      fireEvent.click(first);
      await waitFor(() => expect(first).toHaveAttribute("aria-pressed", "true"));
      fireEvent.click(second);
      await waitFor(() => expect(second).toHaveAttribute("aria-pressed", "true"));
      expect(confirmSpy).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("asks before Cancel throws typed work away", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<NewActivityPage />);
      await fillStep1();
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
      expect(nav.push).not.toHaveBeenCalledWith("/teacher/activities");
      confirmSpy.mockReturnValue(true);
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      await waitFor(() => expect(nav.push).toHaveBeenLastCalledWith("/teacher/activities"));
    } finally {
      confirmSpy.mockRestore();
    }
  });

  // ── Blocked states ────────────────────────────────────────────────────────

  it("shows a create-a-class-first empty state when the teacher has no classes", async () => {
    listClassesMock.mockResolvedValue([]);
    render(<NewActivityPage />);
    expect(await screen.findByText(/create a class first/i)).toBeInTheDocument();
  });

  it("surfaces an error state when classes fail to load", async () => {
    listClassesMock.mockRejectedValue(new Error("boom"));
    render(<NewActivityPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/your classes could not be loaded/i);
  });

  it("shows a not-seeded state when the concept-dialogue skill is missing", async () => {
    listClassesMock.mockResolvedValue(ONE_CLASS);
    listSkillsMock.mockResolvedValue([]); // catalogue has no concept-dialogue
    render(<NewActivityPage />);
    // Rule 6 (1.1.108): the message does not name the internal skill id.
    expect(await screen.findByText(/activity tutor isn't set up here yet/i)).toBeInTheDocument();
  });
});
