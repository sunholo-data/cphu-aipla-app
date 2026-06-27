import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { ToolCallState, UseSkillAgentReturn } from "@/hooks/useSkillAgent";

// Capture AGUIProvider props so we can assert the auth corner (useTeacherAuth).
let aguiProps: Record<string, unknown> | null = null;
vi.mock("@/providers/AGUIProvider", () => ({
  AGUIProvider: (props: { children: React.ReactNode; useTeacherAuth?: boolean }) => {
    aguiProps = props;
    return <>{props.children}</>;
  },
}));

vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ skillId: "skill-uuid" }),
  }),
}));

const sendMessage = vi.fn();
let mockHook: Partial<UseSkillAgentReturn>;
vi.mock("@/hooks/useSkillAgent", () => ({
  useSkillAgent: () => mockHook as UseSkillAgentReturn,
}));

import { AuthoringCopilot, parseProposal } from "../_AuthoringCopilot";

function tc(over: Partial<ToolCallState>): ToolCallState {
  return { id: "t1", name: "set_lesson_prompt", status: "success", ...over } as ToolCallState;
}
// The backend proposal envelope: { ok, proposal: { kind, field, value } }.
const PROPOSAL = JSON.stringify({
  ok: true,
  proposal: { kind: "set_lesson_prompt", field: "teachingGoal", value: "Udforsk energibevarelse." },
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_AUTHORING_COPILOT = "1";
  aguiProps = null;
  mockHook = { messages: [], toolCalls: [], sendMessage, isLoading: false, error: null };
  sendMessage.mockReset();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_AUTHORING_COPILOT;
  vi.clearAllMocks();
});

describe("parseProposal (generalized dispatch)", () => {
  it("returns a typed proposal for a successful set_lesson_prompt result", () => {
    expect(parseProposal(tc({ resultContent: PROPOSAL }))).toEqual({
      kind: "set_lesson_prompt",
      value: "Udforsk energibevarelse.",
    });
  });
  it("returns null for failed / non-JSON / denied / unknown-kind results", () => {
    expect(parseProposal(tc({ status: "error", resultContent: PROPOSAL }))).toBeNull();
    expect(parseProposal(tc({ resultContent: "not json" }))).toBeNull();
    expect(parseProposal(tc({ resultContent: JSON.stringify({ ok: false, error: "x" }) }))).toBeNull();
    // A newer tool than this build (kind we don't render yet) → null, not a crash.
    expect(
      parseProposal(tc({ resultContent: JSON.stringify({ ok: true, proposal: { kind: "future_tool", value: "x" } }) })),
    ).toBeNull();
  });
});

describe("AuthoringCopilot — dark flag (degradation)", () => {
  it("renders nothing when the flag is off (builder unaffected)", () => {
    delete process.env.NEXT_PUBLIC_AUTHORING_COPILOT;
    const { container } = render(<AuthoringCopilot activityId="act-1" onApplyProposal={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AuthoringCopilot — auth corner + panel", () => {
  it("mounts the stream with the TEACHER token (useTeacherAuth), never the group token", async () => {
    render(<AuthoringCopilot activityId="act-1" onApplyProposal={vi.fn()} />);
    await screen.findByTestId("authoring-copilot");
    expect(aguiProps?.useTeacherAuth).toBe(true);
  });

  it("prefixes the activity_id onto the sent message (the agent's contract)", async () => {
    render(<AuthoringCopilot activityId="act-42" onApplyProposal={vi.fn()} />);
    await screen.findByTestId("authoring-copilot");
    fireEvent.change(screen.getByLabelText(/beskriv hvad du vil undervise/i), { target: { value: "energi" } });
    fireEvent.submit(screen.getByRole("button", { name: /send/i }).closest("form")!);
    expect(sendMessage).toHaveBeenCalledWith("[activity_id=act-42] energi");
  });

  it("omits the prefix when there's no activity yet (draft / the /new page)", async () => {
    render(<AuthoringCopilot activityId="" onApplyProposal={vi.fn()} />);
    await screen.findByTestId("authoring-copilot");
    fireEvent.change(screen.getByLabelText(/beskriv hvad du vil undervise/i), { target: { value: "energi" } });
    fireEvent.submit(screen.getByRole("button", { name: /send/i }).closest("form")!);
    expect(sendMessage).toHaveBeenCalledWith("energi");
  });

  it("floats and can be minimized to a pill, then restored", async () => {
    render(<AuthoringCopilot activityId="act-1" onApplyProposal={vi.fn()} />);
    await screen.findByTestId("authoring-copilot");
    expect(screen.queryByTestId("copilot-fab")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /skjul medbygger/i }));
    expect(screen.getByTestId("copilot-fab")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("copilot-fab"));
    expect(screen.queryByTestId("copilot-fab")).not.toBeInTheDocument();
  });
});

describe("AuthoringCopilot — proposal card", () => {
  async function renderWithProposal(onApply = vi.fn()) {
    mockHook.toolCalls = [tc({ resultContent: PROPOSAL })];
    render(<AuthoringCopilot activityId="act-1" onApplyProposal={onApply} />);
    await screen.findByTestId("proposal-card");
    return onApply;
  }

  it("renders the proposed prompt + Apply routes the typed proposal", async () => {
    const onApply = await renderWithProposal();
    expect(screen.getByText("Udforsk energibevarelse.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /anvend/i }));
    expect(onApply).toHaveBeenCalledWith({ kind: "set_lesson_prompt", value: "Udforsk energibevarelse." });
    expect(screen.getByRole("status")).toHaveTextContent(/anvendt/i);
  });

  it("Edit lets the teacher refine the text before applying", async () => {
    const onApply = await renderWithProposal();
    fireEvent.click(screen.getByRole("button", { name: /rediger/i }));
    fireEvent.change(screen.getByLabelText(/rediger forslag/i), { target: { value: "Min egen prompt" } });
    fireEvent.click(screen.getByRole("button", { name: /brug denne/i }));
    expect(onApply).toHaveBeenCalledWith({ kind: "set_lesson_prompt", value: "Min egen prompt" });
  });

  it("Dismiss removes the card without applying", async () => {
    const onApply = await renderWithProposal();
    fireEvent.click(screen.getByRole("button", { name: /afvis/i }));
    expect(screen.queryByTestId("proposal-card")).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });
});

const ADD_ELEMENT = JSON.stringify({
  ok: true,
  proposal: {
    kind: "add_element",
    element_kind: "checklist",
    spec: { items: ["Find massen", "Beregn energien"] },
    label: "Tjekliste (2 trin)",
  },
});

describe("AuthoringCopilot — add_element proposal (COPILOT-2 M1)", () => {
  it("parseProposal returns a typed add_element proposal", () => {
    expect(parseProposal(tc({ name: "add_element", resultContent: ADD_ELEMENT }))).toEqual({
      kind: "add_element",
      elementKind: "checklist",
      items: ["Find massen", "Beregn energien"],
      label: "Tjekliste (2 trin)",
    });
  });

  it("renders the checklist items + Apply routes the add_element proposal", async () => {
    const onApply = vi.fn();
    mockHook.toolCalls = [tc({ name: "add_element", resultContent: ADD_ELEMENT })];
    render(<AuthoringCopilot activityId="act-1" onApplyProposal={onApply} />);
    await screen.findByTestId("proposal-card");
    expect(screen.getByTestId("proposal-items")).toHaveTextContent("Find massen");
    fireEvent.click(screen.getByRole("button", { name: /anvend/i }));
    expect(onApply).toHaveBeenCalledWith({
      kind: "add_element",
      elementKind: "checklist",
      items: ["Find massen", "Beregn energien"],
      label: "Tjekliste (2 trin)",
    });
  });
});

const SET_ARTEFACT = JSON.stringify({
  ok: true,
  proposal: { kind: "set_artefact", artefactId: "boldkast", label: "Boldkast — projektilbevægelse" },
});

describe("AuthoringCopilot — set_artefact proposal (COPILOT-2 M2)", () => {
  it("parseProposal returns a typed set_artefact proposal", () => {
    expect(parseProposal(tc({ name: "set_artefact", resultContent: SET_ARTEFACT }))).toEqual({
      kind: "set_artefact",
      artefactId: "boldkast",
      label: "Boldkast — projektilbevægelse",
    });
  });

  it("renders the sim label + Apply routes the set_artefact proposal", async () => {
    const onApply = vi.fn();
    mockHook.toolCalls = [tc({ name: "set_artefact", resultContent: SET_ARTEFACT })];
    render(<AuthoringCopilot activityId="act-1" onApplyProposal={onApply} />);
    await screen.findByTestId("proposal-card");
    expect(screen.getByTestId("proposal-sim")).toHaveTextContent("Boldkast");
    fireEvent.click(screen.getByRole("button", { name: /anvend/i }));
    expect(onApply).toHaveBeenCalledWith({
      kind: "set_artefact",
      artefactId: "boldkast",
      label: "Boldkast — projektilbevægelse",
    });
  });
});

const NOTE = JSON.stringify({
  ok: true,
  proposal: { kind: "add_element", element_kind: "note", spec: { title: "Energi", body: "Måles i joule." }, label: "Note: Energi" },
});
const SOLUTION = JSON.stringify({
  ok: true,
  proposal: { kind: "add_element", element_kind: "solution", spec: { prompt: "Vis din løsning." }, label: "Løsningsfelt" },
});
const DOCUMENT = JSON.stringify({
  ok: true,
  proposal: { kind: "add_element", element_kind: "document", spec: { prompt: "Upload din opgave." }, label: "Dokument-upload" },
});

describe("AuthoringCopilot — note/solution/document elements (COPILOT-2 M3)", () => {
  it("parses + Apply routes a note proposal", async () => {
    expect(parseProposal(tc({ resultContent: NOTE }))).toEqual({
      kind: "add_element", elementKind: "note", title: "Energi", body: "Måles i joule.", label: "Note: Energi",
    });
    const onApply = vi.fn();
    mockHook.toolCalls = [tc({ resultContent: NOTE })];
    render(<AuthoringCopilot activityId="act-1" onApplyProposal={onApply} />);
    await screen.findByTestId("proposal-note");
    fireEvent.click(screen.getByRole("button", { name: /anvend/i }));
    expect(onApply).toHaveBeenCalledWith({ kind: "add_element", elementKind: "note", title: "Energi", body: "Måles i joule.", label: "Note: Energi" });
  });

  it("parses solution + document (student drawing/upload) as prompt elements", () => {
    expect(parseProposal(tc({ resultContent: SOLUTION }))).toEqual({
      kind: "add_element", elementKind: "solution", prompt: "Vis din løsning.", label: "Løsningsfelt",
    });
    expect(parseProposal(tc({ resultContent: DOCUMENT }))).toEqual({
      kind: "add_element", elementKind: "document", prompt: "Upload din opgave.", label: "Dokument-upload",
    });
  });

  it("renders the solution prompt + Apply routes it (the student drawing surface)", async () => {
    const onApply = vi.fn();
    mockHook.toolCalls = [tc({ resultContent: SOLUTION })];
    render(<AuthoringCopilot activityId="act-1" onApplyProposal={onApply} />);
    await screen.findByTestId("proposal-prompt");
    fireEvent.click(screen.getByRole("button", { name: /anvend/i }));
    expect(onApply).toHaveBeenCalledWith({ kind: "add_element", elementKind: "solution", prompt: "Vis din løsning.", label: "Løsningsfelt" });
  });
});

const TABLE = JSON.stringify({
  ok: true,
  proposal: { kind: "add_element", element_kind: "table", spec: { title: "Målinger", columns: [{ label: "tid", unit: "s", kind: "number" }], rows: 6 }, label: "Tabel (1 kolonner)" },
});
const CHART = JSON.stringify({
  ok: true,
  proposal: { kind: "add_element", element_kind: "chart", spec: { title: "v-t", chartKind: "line" }, label: "Graf (line)" },
});
const CALC = JSON.stringify({
  ok: true,
  proposal: { kind: "add_element", element_kind: "calculator", spec: { title: "Fart", formula: "s / t", inputs: [{ id: "s", label: "strækning", unit: "m" }, { id: "t", label: "tid", unit: "s" }] }, label: "Lommeregner" },
});

describe("AuthoringCopilot — structured elements table/chart/calculator (COPILOT-2 M4)", () => {
  it("parses + Apply routes a table proposal", async () => {
    expect(parseProposal(tc({ resultContent: TABLE }))).toEqual({
      kind: "add_element", elementKind: "table", title: "Målinger", columns: [{ label: "tid", unit: "s", kind: "number" }], rows: 6, label: "Tabel (1 kolonner)",
    });
    const onApply = vi.fn();
    mockHook.toolCalls = [tc({ resultContent: TABLE })];
    render(<AuthoringCopilot activityId="act-1" onApplyProposal={onApply} />);
    expect(await screen.findByTestId("proposal-table")).toHaveTextContent("tid");
    fireEvent.click(screen.getByRole("button", { name: /anvend/i }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ elementKind: "table", rows: 6 }));
  });

  it("parses chart (kind) + calculator (formula + inputs)", () => {
    expect(parseProposal(tc({ resultContent: CHART }))).toEqual({
      kind: "add_element", elementKind: "chart", title: "v-t", chartKind: "line", label: "Graf (line)",
    });
    expect(parseProposal(tc({ resultContent: CALC }))).toEqual({
      kind: "add_element", elementKind: "calculator", title: "Fart", formula: "s / t",
      inputs: [{ id: "s", label: "strækning", unit: "m" }, { id: "t", label: "tid", unit: "s" }], label: "Lommeregner",
    });
  });

  it("renders the calculator formula + Apply routes it", async () => {
    const onApply = vi.fn();
    mockHook.toolCalls = [tc({ resultContent: CALC })];
    render(<AuthoringCopilot activityId="act-1" onApplyProposal={onApply} />);
    expect(await screen.findByTestId("proposal-calc")).toHaveTextContent("s / t");
    fireEvent.click(screen.getByRole("button", { name: /anvend/i }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ elementKind: "calculator", formula: "s / t" }));
  });
});
