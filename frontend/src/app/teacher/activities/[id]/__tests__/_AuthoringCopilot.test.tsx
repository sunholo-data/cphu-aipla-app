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
