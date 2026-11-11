import { act, render as rtlRender, renderHook, screen, within, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ActivityBuilderBody } from "@/components/teacher/ActivityBuilderBody";
import { Toaster } from "@/components/ui/toast";
import { WORKSPACE_KINDS } from "@/components/teacher/WorkspaceElements";
import { ELEMENT_KINDS } from "@/lib/activityElements";
import { useActivityBuilder, type ActivityBuilder } from "@/hooks/useActivityBuilder";

import { LocaleProvider } from "@/i18n";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish, so render inside an English locale (the teacher chose EN).
function EnglishUI({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}
const render = (ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: EnglishUI, ...options });

// Characterization tests for the shared activity-builder workspace (1.1.40 M1).
// The body renders title/language/checklist controls inline and delegates each
// element to a dedicated editor child. We mock the heavy / network-dependent
// children (SimPicker → listArtefacts fetch, MaterialsSection → image API,
// ActivityPreview → the full StudentWorkspace tree) with lightweight stubs that
// faithfully echo their value/onChange contract, so the test stays behavioural
// (DOM text/roles + builder callback args) and deterministic — no network.

// --- SimPicker: echoes the current sim id and lets us attach/clear it. -------
vi.mock("@/components/teacher/SimPicker", () => ({
  SimPicker: ({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) => (
    <div data-testid="sim-picker">
      <span data-testid="sim-value">{value ?? "none"}</span>
      <button type="button" onClick={() => onChange("boldkast")}>
        mock-attach-sim
      </button>
      <button type="button" onClick={() => onChange(null)}>
        mock-clear-sim
      </button>
    </div>
  ),
}));

// --- MaterialsSection: shows the materials count (no upload API in tests). ----
vi.mock("@/components/teacher/MaterialsSection", () => ({
  MaterialsSection: ({ materials, activityId }: { materials: unknown[]; activityId?: string }) => (
    <div data-testid="materials-section">
      materials:{materials.length}|activityId:{activityId ?? ""}
    </div>
  ),
}));

// --- ActivityPreview: pin the props it receives without the workspace tree. --
vi.mock("@/components/teacher/ActivityPreview", () => ({
  ActivityPreview: (props: {
    artefactId: string | null;
    activityId?: string;
    state: { checklist: { label: string }[]; table: unknown[] };
  }) => (
    <div data-testid="activity-preview">
      preview|artefact:{props.artefactId ?? "none"}|activityId:{props.activityId ?? ""}|checklist:
      {props.state.checklist.length}|table:{props.state.table?.length ? "yes" : "no"}
    </div>
  ),
}));

// --- Each element editor: a stub that shows its enabled/disabled state and a
//     toggle, so we can assert "which editor shows for which element" and that
//     the body wires the editor's onChange to the right builder setter. --------
function editorStub(name: string, enabledValue: unknown, clearedValue: unknown = null) {
  // `on` must not be a bare truthiness check: an empty ARRAY is truthy, so a
  // list-valued editor would read as "on" with nothing in it (the same trap that
  // put a phantom table in workspaceCount).
  const isOn = (v: unknown) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
  const Stub = ({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) => (
    <div data-testid={`${name}-editor`}>
      <span data-testid={`${name}-state`}>{isOn(value) ? "on" : "off"}</span>
      <button type="button" onClick={() => onChange(enabledValue)}>
        mock-enable-{name}
      </button>
      <button type="button" onClick={() => onChange(clearedValue)}>
        mock-clear-{name}
      </button>
    </div>
  );
  Stub.displayName = `${name}EditorStub`;
  return Stub;
}

// 1.1.71 — tables are a LIST. The stub emits one, and "clear" is an empty
// array rather than null: `setTable` reconciles over the array and a null would
// throw on the next render.
// The add menu imports `newTable` / `MAX_TABLES` from the real module.
vi.mock("@/components/teacher/TableEditor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/teacher/TableEditor")>()),
  TableEditor: editorStub(
    "table",
    [
      {
        key: 1,
        title: "T",
        rows: 3,
        columns: [{ key: 2, label: "Tid", unit: "s", kind: "number" }],
      },
    ],
    [],
  ),
}));
vi.mock("@/components/teacher/ChartEditor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/teacher/ChartEditor")>()),
  // ChartEditor additionally receives the `table` (1.1.64 — it needs the
  // columns for the axis pickers); echo its numeric column count.
  ChartEditor: ({
    value,
    onChange,
    tables,
  }: {
    // 1.1.64 — charts are a LIST, and the editor takes the tables themselves
    // (it needs the columns for the axis pickers) rather than a hasTable
    // boolean. 1.1.71 — plural: a chart picks WHICH table it plots.
    value: { title: string }[];
    onChange: (v: unknown) => void;
    tables: { columns: { label: string; kind: string }[] }[];
  }) => (
    <div data-testid="chart-editor">
      <span data-testid="chart-state">{value?.length ? "on" : "off"}</span>
      <span data-testid="chart-count">{value?.length ?? 0}</span>
      <span data-testid="chart-numeric-columns">
        {String((tables?.[0]?.columns ?? []).filter((c) => c.kind === "number" && c.label.trim()).length)}
      </span>
      <button type="button" onClick={() => onChange([...(value ?? []), { title: "G", chartKind: "line" }])}>
        mock-enable-chart
      </button>
    </div>
  ),
}));
vi.mock("@/components/teacher/CalculatorEditor", () => ({
  CalculatorEditor: editorStub("calculator", {
    title: "C",
    formula: "s / t",
    inputs: [{ key: 1, id: "s", label: "S", unit: "m" }],
  }),
}));
vi.mock("@/components/teacher/NoteEditor", () => ({
  NoteEditor: editorStub("note", { title: "N", body: "body" }),
}));
vi.mock("@/components/teacher/SolutionEditor", () => ({
  SolutionEditor: editorStub("solution", { prompt: "p" }),
}));
vi.mock("@/components/teacher/DocumentEditor", () => ({
  DocumentEditor: editorStub("document", { prompt: "d" }),
}));

// Render the real ActivityBuilderBody driven by a real useActivityBuilder.
// The hook MUST live inside the same React tree as the body so its state
// updates re-render the body (a separate renderHook tree would not propagate).
// `onBuilder` captures the latest builder instance for assertions if needed.
function Harness({
  onBuilder,
  ...props
}: Partial<React.ComponentProps<typeof ActivityBuilderBody>> & {
  onBuilder?: (b: ActivityBuilder) => void;
}) {
  const builder = useActivityBuilder();
  onBuilder?.(builder);
  return (
    <ActivityBuilderBody
      builder={builder}
      footer={<button type="submit">Create activity</button>}
      {...props}
    />
  );
}

function setup(
  props: Partial<React.ComponentProps<typeof ActivityBuilderBody>> = {},
): { getBuilder: () => ActivityBuilder } {
  let latest: ActivityBuilder | undefined;
  render(<Harness onBuilder={(b) => (latest = b)} {...props} />);
  return { getBuilder: () => latest as ActivityBuilder };
}

/** Open "Add to the workspace" and pick one element type from the grid. */
async function addElement(user: ReturnType<typeof userEvent.setup>, kind: string) {
  await user.click(screen.getByRole("button", { name: "Add to the workspace" }));
  await user.click(await screen.findByTestId(`workspace-add-${kind}`));
}

/** Open a workspace card's ⋯ menu and choose an item. */
async function cardMenu(user: ReturnType<typeof userEvent.setup>, name: string, item: string) {
  const trigger = screen.getByRole("button", { name: `More actions for ${name}` });
  trigger.focus();
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

describe("ActivityBuilderBody — setup section", () => {
  it("renders the title input, language select, and footer", () => {
    setup();
    expect(screen.getByLabelText("Activity name")).toBeInTheDocument();
    // 1.1.108 — the field is the STUDENTS' language, and says so.
    expect(screen.getByLabelText(/students' language/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create activity" })).toBeInTheDocument();
  });

  it("typing in the title input drives builder.setTitle", async () => {
    const user = userEvent.setup();
    setup();
    const input = screen.getByLabelText("Activity name");
    await user.type(input, "Projectile");
    expect(input).toHaveValue("Projectile");
  });

  it("the language select reflects the builder language and updates on change", async () => {
    const user = userEvent.setup();
    setup();
    const select = screen.getByLabelText(/students' language/i) as HTMLSelectElement;
    expect(select.value).toBe("da");
    await user.selectOptions(select, "en");
    expect(select.value).toBe("en");
  });

  it("renders the injected classControl, and the tutor summary as a row with its change link", () => {
    setup({
      classControl: <div>MOCK_CLASS_CONTROL</div>,
      tutorSummary: <span>MOCK_TUTOR</span>,
      tutorChangeHref: "/teacher/classes/c-9",
    });
    expect(screen.getByText("MOCK_CLASS_CONTROL")).toBeInTheDocument();
    const summary = screen.getByTestId("activity-summary");
    expect(within(summary).getByText("MOCK_TUTOR")).toBeInTheDocument();
    expect(within(summary).getByRole("link", { name: "Change in the class" })).toHaveAttribute(
      "href",
      "/teacher/classes/c-9",
    );
  });

  it("renders the error node when provided", () => {
    setup({ error: <p role="alert">boom</p> });
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  // UI sweep 2026-11-11 — the "where settings live" map left the builder.
  it("no longer renders the settings map", () => {
    setup();
    expect(screen.queryByText(/where settings live/i)).toBeNull();
  });
});

describe("ActivityBuilderBody — summary block (UI sweep 2026-11-11)", () => {
  it("summarises the student view and opens the picker in place; the choice is saved", async () => {
    const user = userEvent.setup();
    const { getBuilder } = setup();
    const summary = screen.getByTestId("activity-summary");
    expect(within(summary).getByText("Conversation first")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /work first/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Change: Student view" }));
    await user.click(screen.getByRole("radio", { name: /work first/i }));
    expect(getBuilder().toSavePayload().studentView).toBe("workbench");
    await user.click(screen.getByRole("button", { name: "Close: Student view" }));
    expect(within(summary).getByText("Work first")).toBeInTheDocument();
  });

  it("collapses the opening to a summary, and opens it on its own when a field is set", () => {
    const { result } = renderHook(() => useActivityBuilder());
    const first = render(<ActivityBuilderBody builder={result.current} />);
    expect(screen.queryByLabelText("Student introduction (optional)")).toBeNull();
    expect(screen.getByText(/The default introduction · default suggestions/)).toBeInTheDocument();
    first.unmount();

    act(() => result.current.setStarterPrompts(["What do I measure?"]));
    render(<ActivityBuilderBody builder={result.current} />);
    expect(screen.getByLabelText("Student introduction (optional)")).toBeInTheDocument();
    expect(screen.getByText(/1 starter prompt/)).toBeInTheDocument();
  });
});

describe("ActivityBuilderBody — lesson section", () => {
  it("edits the student opening, classroom handoff and starter prompts through mounted controls", async () => {
    const user = userEvent.setup();
    const { getBuilder } = setup();
    await user.click(screen.getByRole("button", { name: "Change: Students see first" }));
    await user.type(screen.getByLabelText("Student introduction (optional)"), "Start by measuring.");
    await user.click(screen.getByRole("checkbox", { name: "I’ll introduce this activity in class myself" }));
    await user.click(screen.getByRole("button", { name: "Add starter prompt" }));
    await user.type(screen.getByLabelText("Starter prompt 1"), "What should I measure?");
    expect(getBuilder().toSavePayload()).toMatchObject({ studentOpening: "Start by measuring.",
      openingByTeacher: true, starterPrompts: ["What should I measure?"] });
  });
  it("renders the teaching-goal textarea and updates it", async () => {
    const user = userEvent.setup();
    setup();
    const ta = screen.getByLabelText(/Lesson prompt/);
    await user.type(ta, "Discover independence");
    expect(ta).toHaveValue("Discover independence");
  });
});

describe("ActivityBuilderBody — workspace: add on demand (UI sweep 2026-11-11)", () => {
  it("starts with nothing added: the intro, one Add button, no editors", () => {
    setup();
    expect(screen.getByText(/Optionally host a vetted simulation/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to the workspace" })).toBeInTheDocument();
    for (const name of ["table", "calculator", "note", "solution", "document"]) {
      expect(screen.queryByTestId(`${name}-editor`)).toBeNull();
    }
    expect(screen.queryByTestId("chart-editor")).toBeNull();
    expect(screen.queryByTestId("sim-picker")).toBeNull();
  });

  it("the add grid lists every element type with its help line", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add to the workspace" }));
    const dialog = await screen.findByRole("dialog");
    for (const kind of ["sim", "checklist", "table", "chart", "calculator", "note", "writing", "solution", "document"]) {
      expect(within(dialog).getByTestId(`workspace-add-${kind}`)).toBeInTheDocument();
    }
    // The help line is the element's existing `help` copy.
    expect(within(dialog).getByTestId("workspace-add-checklist")).toHaveTextContent(/Sub-steps students tick off/);
    // Concept map only behind NEXT_PUBLIC_CONCEPT_MAP (off in tests).
    expect(within(dialog).queryByTestId("workspace-add-conceptMap")).toBeNull();
  });

  it("an added element appears as an open card and is in the save payload", async () => {
    const user = userEvent.setup();
    const { getBuilder } = setup();
    await addElement(user, "note");
    expect(screen.getByTestId("workspace-card-note")).toBeInTheDocument();
    // Added from the menu ⇒ its editor is open.
    expect(screen.getByTestId("note-editor")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "mock-enable-note" }));
    expect(getBuilder().toSavePayload().note).toEqual([{ id: "note-1", title: "N", body: "body" }]);
  });

  it("a single-instance element shows 'added' in the grid and cannot be added twice", async () => {
    const user = userEvent.setup();
    setup();
    await addElement(user, "solution");
    await user.click(screen.getByRole("button", { name: "Add to the workspace" }));
    const item = await screen.findByTestId("workspace-add-solution");
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent(/added/);
    // A list element stays addable until its cap.
    expect(screen.getByTestId("workspace-add-table")).not.toBeDisabled();
  });

  it("removing an element takes it out of the payload, and Undo puts it back", async () => {
    const user = userEvent.setup();
    const { getBuilder } = setup();
    render(<Toaster />);
    await addElement(user, "calculator");
    await user.click(screen.getByRole("button", { name: "mock-enable-calculator" }));
    expect(getBuilder().toSavePayload().calculator).toHaveLength(1);

    await cardMenu(user, "Calculator", "Remove");
    expect(screen.queryByTestId("workspace-card-calculator")).toBeNull();
    expect(getBuilder().toSavePayload().calculator).toEqual([]);

    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("workspace-card-calculator")).toBeInTheDocument();
    expect(getBuilder().toSavePayload().calculator).toHaveLength(1);
  });

  it("a card rests as a summary and Edit opens its editor", async () => {
    const user = userEvent.setup();
    setup();
    await addElement(user, "document");
    await user.click(screen.getByRole("button", { name: "Close Document upload" }));
    expect(screen.queryByTestId("document-editor")).toBeNull();
    expect(screen.getByTestId("workspace-card-document")).toHaveTextContent("Not filled in yet");
    await user.click(screen.getByRole("button", { name: "Edit Document upload" }));
    expect(screen.getByTestId("document-editor")).toBeInTheDocument();
  });

  it("Simulation opens the sim picker in a dialog; picking one attaches it as a card", async () => {
    const user = userEvent.setup();
    const { getBuilder } = setup();
    await addElement(user, "sim");
    const dialog = await screen.findByRole("dialog", { name: "Choose a simulation" });
    await user.click(within(dialog).getByRole("button", { name: "mock-attach-sim" }));
    expect(getBuilder().toSavePayload().artefactId).toBe("boldkast");
    expect(screen.getByTestId("workspace-card-sim")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an element set by the builder itself (a load, a template, the co-pilot) appears with no wiring", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => {
      result.current.addChecklistItems(["Measure", "Plot"]);
      result.current.setTable([{ key: 9, title: "T", rows: 3, columns: [{ key: 10, label: "t", unit: "s", kind: "number" }] }]);
    });
    render(<ActivityBuilderBody builder={result.current} />);
    expect(screen.getByTestId("workspace-card-checklist")).toHaveTextContent("2 steps");
    expect(screen.getByTestId("workspace-card-table")).toHaveTextContent("1 table");
  });
});

// The add grid is now the ONLY way to add an element by hand, so an element
// kind missing from it would be authorable by the co-pilot and by nobody else.
describe("WORKSPACE_KINDS — covers the element registry", () => {
  it("lists every registered element kind, plus the sim", () => {
    const listed = WORKSPACE_KINDS.map((k) => k.kind).sort();
    expect(listed).toEqual([...ELEMENT_KINDS, "sim"].sort());
  });
});

describe("ActivityBuilderBody — checklist", () => {
  it("adding a checklist opens it with one step; Add step adds another; typing updates it", async () => {
    const user = userEvent.setup();
    const { getBuilder } = setup();
    await addElement(user, "checklist");
    await user.type(screen.getByLabelText("Checklist step 1"), "Identify the system");
    expect(screen.getByLabelText("Checklist step 1")).toHaveValue("Identify the system");
    await user.click(screen.getByRole("button", { name: /Add step/ }));
    expect(screen.getByLabelText("Checklist step 2")).toBeInTheDocument();
    expect(getBuilder().toSavePayload().checklist).toEqual([{ id: "step-1", label: "Identify the system" }]);
  });

  it("removing the last step removes the checklist card", async () => {
    const user = userEvent.setup();
    setup();
    await addElement(user, "checklist");
    await user.click(screen.getByRole("button", { name: "Remove step 1" }));
    expect(screen.queryByTestId("workspace-card-checklist")).toBeNull();
  });
});

describe("ActivityBuilderBody — element editors wire to the builder", () => {
  it("each editor's onChange reaches the right builder setter", async () => {
    const user = userEvent.setup();
    setup();
    for (const name of ["table", "calculator", "note", "solution", "document"]) {
      await addElement(user, name);
      await user.click(screen.getByRole("button", { name: `mock-enable-${name}` }));
      expect(screen.getByTestId(`${name}-state`)).toHaveTextContent("on");
    }
    await addElement(user, "chart");
    expect(screen.getByTestId("chart-state")).toHaveTextContent("on");
  });

  it("ChartEditor gets the table so it can offer axis pickers (1.1.64)", async () => {
    const user = userEvent.setup();
    setup();
    await addElement(user, "table");
    // The table stub sets ONE numeric column — still not enough for an x/y
    // pair, which is what the editor explains to the teacher.
    await user.click(screen.getByRole("button", { name: "mock-enable-table" }));
    await addElement(user, "chart");
    expect(screen.getByTestId("chart-numeric-columns")).toHaveTextContent("1");
  });

  it("adding a second chart keeps the first (1.1.64)", async () => {
    const user = userEvent.setup();
    setup();
    await addElement(user, "chart");
    await addElement(user, "chart");
    expect(screen.getByTestId("chart-count")).toHaveTextContent("2");
  });
});

describe("ActivityBuilderBody — section nav counts", () => {
  it("the workspace count badge increases as elements are added", async () => {
    const user = userEvent.setup();
    setup();
    await addElement(user, "checklist");
    await addElement(user, "note");
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("ActivityBuilderBody — preview reflects live builder state", () => {
  it("passes the activityId and live element state to ActivityPreview", async () => {
    const user = userEvent.setup();
    setup({ activityId: "act-xyz" });
    const preview = screen.getByTestId("activity-preview");
    expect(preview).toHaveTextContent("activityId:act-xyz");
    expect(preview).toHaveTextContent("artefact:none");
    expect(preview).toHaveTextContent("checklist:0");
    expect(preview).toHaveTextContent("table:no");

    await addElement(user, "sim");
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "mock-attach-sim" }));
    await addElement(user, "checklist");
    await addElement(user, "table");

    expect(preview).toHaveTextContent("artefact:boldkast");
    expect(preview).toHaveTextContent("checklist:1");
    expect(preview).toHaveTextContent("table:yes");
  });

  it("threads activityId into the MaterialsSection", () => {
    setup({ activityId: "act-xyz" });
    expect(screen.getByTestId("materials-section")).toHaveTextContent("activityId:act-xyz");
  });
});

describe("ActivityBuilderBody — works with a directly-mutated builder (no re-render gap)", () => {
  // Confirms the body reflects builder state set imperatively (mirrors how the
  // edit page hydrates() before/independent of user interaction).
  it("renders pre-populated title and checklist from a hydrated builder", async () => {
    const user = userEvent.setup();
    const { result } = renderHook(() => useActivityBuilder());
    act(() => {
      result.current.setTitle("Pre-filled");
      result.current.addChecklistItems(["a", "b"]);
    });
    render(<ActivityBuilderBody builder={result.current} footer={<span>f</span>} />);
    expect(screen.getByLabelText("Activity name")).toHaveValue("Pre-filled");
    await user.click(screen.getByRole("button", { name: "Edit Checklist" }));
    const list = screen.getAllByRole("list").find((list) => within(list).queryAllByRole("textbox").length > 0)!;
    expect(within(list).getAllByRole("textbox")).toHaveLength(2);
  });
});

// 1.1.151 F2b/F2c — the students' language is visible and a wrong-looking
// value earns a soft, non-blocking hint.
describe("ActivityBuilderBody — students' language hint (1.1.151)", () => {
  it("hints when an English activity has a Danish title, and never blocks save", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByTestId("builder-hints")).toBeNull();
    await user.type(screen.getByLabelText("Activity name"), "Bølger og lyd");
    await user.selectOptions(screen.getByLabelText(/students' language/i), "en");
    expect(screen.getByTestId("builder-hints")).toHaveTextContent(
      "The title is in Danish, but the students get an English tutor. Is that intended?",
    );
    expect(screen.getByRole("button", { name: "Create activity" })).not.toBeDisabled();
  });

  it("puts the language field beside the title (same row container)", () => {
    setup();
    const title = screen.getByLabelText("Activity name");
    const language = screen.getByLabelText(/students' language/i);
    const row = title.closest("div.sm\\:flex-row");
    expect(row).not.toBeNull();
    expect(row?.contains(language)).toBe(true);
  });
});
