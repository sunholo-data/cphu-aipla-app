import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ActivityBuilderBody } from "@/components/teacher/ActivityBuilderBody";
import { useActivityBuilder, type ActivityBuilder } from "@/hooks/useActivityBuilder";

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
    state: { checklist: { label: string }[]; table: unknown };
  }) => (
    <div data-testid="activity-preview">
      preview|artefact:{props.artefactId ?? "none"}|activityId:{props.activityId ?? ""}|checklist:
      {props.state.checklist.length}|table:{props.state.table ? "yes" : "no"}
    </div>
  ),
}));

// --- Each element editor: a stub that shows its enabled/disabled state and a
//     toggle, so we can assert "which editor shows for which element" and that
//     the body wires the editor's onChange to the right builder setter. --------
function editorStub(name: string, enabledValue: unknown) {
  const Stub = ({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) => (
    <div data-testid={`${name}-editor`}>
      <span data-testid={`${name}-state`}>{value ? "on" : "off"}</span>
      <button type="button" onClick={() => onChange(enabledValue)}>
        mock-enable-{name}
      </button>
      <button type="button" onClick={() => onChange(null)}>
        mock-clear-{name}
      </button>
    </div>
  );
  Stub.displayName = `${name}EditorStub`;
  return Stub;
}

vi.mock("@/components/teacher/TableEditor", () => ({
  TableEditor: editorStub("table", {
    title: "T",
    rows: 3,
    columns: [{ key: 1, label: "Tid", unit: "s", kind: "number" }],
  }),
}));
vi.mock("@/components/teacher/ChartEditor", () => ({
  // ChartEditor additionally receives the `table` (1.1.64 — it needs the
  // columns for the axis pickers); echo its numeric column count.
  ChartEditor: ({
    value,
    onChange,
    table,
  }: {
    // 1.1.64 — charts are a LIST, and the editor takes the table itself (it
    // needs the columns for the axis pickers) rather than a hasTable boolean.
    value: { title: string }[];
    onChange: (v: unknown) => void;
    table: { columns: { label: string; kind: string }[] } | null;
  }) => (
    <div data-testid="chart-editor">
      <span data-testid="chart-state">{value?.length ? "on" : "off"}</span>
      <span data-testid="chart-count">{value?.length ?? 0}</span>
      <span data-testid="chart-numeric-columns">
        {String((table?.columns ?? []).filter((c) => c.kind === "number" && c.label.trim()).length)}
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

describe("ActivityBuilderBody — setup section", () => {
  it("renders the title input, language select, and footer", () => {
    setup();
    expect(screen.getByLabelText("Activity name")).toBeInTheDocument();
    expect(screen.getByLabelText("Language")).toBeInTheDocument();
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
    const select = screen.getByLabelText("Language") as HTMLSelectElement;
    expect(select.value).toBe("da");
    await user.selectOptions(select, "en");
    expect(select.value).toBe("en");
  });

  it("renders the injected classControl and personaSlot", () => {
    setup({
      classControl: <div>MOCK_CLASS_CONTROL</div>,
      personaSlot: <div>MOCK_PERSONA</div>,
    });
    expect(screen.getByText("MOCK_CLASS_CONTROL")).toBeInTheDocument();
    expect(screen.getByText("MOCK_PERSONA")).toBeInTheDocument();
  });

  it("renders the error node when provided", () => {
    setup({ error: <p role="alert">boom</p> });
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});

describe("ActivityBuilderBody — lesson section", () => {
  it("renders the teaching-goal textarea and updates it", async () => {
    const user = userEvent.setup();
    setup();
    const ta = screen.getByLabelText(/Lesson prompt/);
    await user.type(ta, "Discover independence");
    expect(ta).toHaveValue("Discover independence");
  });
});

describe("ActivityBuilderBody — checklist controls (inline in the body)", () => {
  it("shows the empty-state hint and no step rows initially", () => {
    setup();
    expect(
      screen.getByText(/No checklist — the activity is a free Socratic dialogue/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Checklist step/)).not.toBeInTheDocument();
  });

  it("'Add step' appends a checklist row", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Add step/ }));
    expect(screen.getByLabelText("Checklist step 1")).toBeInTheDocument();
    // Empty-state hint is gone once a row exists.
    expect(
      screen.queryByText(/No checklist — the activity is a free Socratic dialogue/),
    ).not.toBeInTheDocument();
  });

  it("typing in a checklist row updates it; a second 'Add step' adds another", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Add step/ }));
    await user.type(screen.getByLabelText("Checklist step 1"), "Identify the system");
    expect(screen.getByLabelText("Checklist step 1")).toHaveValue("Identify the system");
    await user.click(screen.getByRole("button", { name: /Add step/ }));
    expect(screen.getByLabelText("Checklist step 2")).toBeInTheDocument();
  });

  it("the remove (X) button drops a checklist row", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Add step/ }));
    expect(screen.getByLabelText("Checklist step 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove step 1" }));
    expect(screen.queryByLabelText("Checklist step 1")).not.toBeInTheDocument();
    expect(
      screen.getByText(/No checklist — the activity is a free Socratic dialogue/),
    ).toBeInTheDocument();
  });
});

describe("ActivityBuilderBody — element editors render and wire to the builder", () => {
  it("renders every element editor child", () => {
    setup();
    expect(screen.getByTestId("table-editor")).toBeInTheDocument();
    expect(screen.getByTestId("chart-editor")).toBeInTheDocument();
    expect(screen.getByTestId("calculator-editor")).toBeInTheDocument();
    expect(screen.getByTestId("note-editor")).toBeInTheDocument();
    expect(screen.getByTestId("solution-editor")).toBeInTheDocument();
    expect(screen.getByTestId("document-editor")).toBeInTheDocument();
    expect(screen.getByTestId("sim-picker")).toBeInTheDocument();
  });

  it("each editor starts 'off' and turns 'on' when its onChange fires (setter wiring)", async () => {
    const user = userEvent.setup();
    setup();

    for (const name of ["table", "calculator", "note", "solution", "document"]) {
      expect(screen.getByTestId(`${name}-state`)).toHaveTextContent("off");
      await user.click(screen.getByRole("button", { name: `mock-enable-${name}` }));
      expect(screen.getByTestId(`${name}-state`)).toHaveTextContent("on");
    }

    // Chart has its own stub (extra hasTable prop) — assert separately.
    expect(screen.getByTestId("chart-state")).toHaveTextContent("off");
    await user.click(screen.getByRole("button", { name: "mock-enable-chart" }));
    expect(screen.getByTestId("chart-state")).toHaveTextContent("on");
  });

  it("attaching/clearing a sim via SimPicker flows through builder.setArtefactId", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByTestId("sim-value")).toHaveTextContent("none");
    await user.click(screen.getByRole("button", { name: "mock-attach-sim" }));
    expect(screen.getByTestId("sim-value")).toHaveTextContent("boldkast");
    await user.click(screen.getByRole("button", { name: "mock-clear-sim" }));
    expect(screen.getByTestId("sim-value")).toHaveTextContent("none");
  });

  it("ChartEditor gets the table so it can offer axis pickers (1.1.64)", async () => {
    const user = userEvent.setup();
    setup();
    // No table → no numeric columns to plot.
    expect(screen.getByTestId("chart-numeric-columns")).toHaveTextContent("0");
    // The table stub enables a table with ONE numeric column — still not enough
    // for an x/y pair, which is what the editor explains to the teacher.
    await user.click(screen.getByRole("button", { name: "mock-enable-table" }));
    expect(screen.getByTestId("chart-numeric-columns")).toHaveTextContent("1");
  });

  it("adding a second chart keeps the first (1.1.64)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "mock-enable-chart" }));
    await user.click(screen.getByRole("button", { name: "mock-enable-chart" }));
    expect(screen.getByTestId("chart-count")).toHaveTextContent("2");
  });
});

describe("ActivityBuilderBody — section nav counts", () => {
  it("the workspace count badge increases as elements are added", async () => {
    const user = userEvent.setup();
    setup();
    // Add a checklist step (+1) and a note (+1) → workspace count 2.
    await user.click(screen.getByRole("button", { name: /Add step/ }));
    await user.click(screen.getByRole("button", { name: "mock-enable-note" }));
    // The BuilderSectionNav renders the workspace count; assert it shows "2".
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

    // Mutate builder state via the children; the preview re-reads it.
    await user.click(screen.getByRole("button", { name: "mock-attach-sim" }));
    await user.click(screen.getByRole("button", { name: /Add step/ }));
    await user.click(screen.getByRole("button", { name: "mock-enable-table" }));

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
  it("renders pre-populated title and checklist from a hydrated builder", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => {
      result.current.setTitle("Pre-filled");
      result.current.addChecklistItems(["a", "b"]);
    });
    render(<ActivityBuilderBody builder={result.current} footer={<span>f</span>} />);
    expect(screen.getByLabelText("Activity name")).toHaveValue("Pre-filled");
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("textbox")).toHaveLength(2);
  });
});
