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

import { AuthoringCopilot, parseLessonProposal } from "../_AuthoringCopilot";

function tc(over: Partial<ToolCallState>): ToolCallState {
  return { id: "t1", name: "set_lesson_prompt", status: "success", ...over } as ToolCallState;
}
const PROPOSAL = JSON.stringify({ ok: true, proposal: { field: "teachingGoal", value: "Udforsk energibevarelse." } });

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

describe("parseLessonProposal", () => {
  it("returns the value for a successful set_lesson_prompt proposal", () => {
    expect(parseLessonProposal(tc({ resultContent: PROPOSAL }))).toBe("Udforsk energibevarelse.");
  });
  it("returns null for a wrong tool / failed / non-JSON / denied result", () => {
    expect(parseLessonProposal(tc({ name: "other", resultContent: PROPOSAL }))).toBeNull();
    expect(parseLessonProposal(tc({ status: "error", resultContent: PROPOSAL }))).toBeNull();
    expect(parseLessonProposal(tc({ resultContent: "not json" }))).toBeNull();
    expect(parseLessonProposal(tc({ resultContent: JSON.stringify({ ok: false, error: "x" }) }))).toBeNull();
  });
});

describe("AuthoringCopilot — dark flag (degradation)", () => {
  it("renders nothing when the flag is off (builder unaffected)", () => {
    delete process.env.NEXT_PUBLIC_AUTHORING_COPILOT;
    const { container } = render(<AuthoringCopilot activityId="act-1" onApplyLessonPrompt={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AuthoringCopilot — auth corner + panel", () => {
  it("mounts the stream with the TEACHER token (useTeacherAuth), never the group token", async () => {
    render(<AuthoringCopilot activityId="act-1" onApplyLessonPrompt={vi.fn()} />);
    await screen.findByTestId("authoring-copilot");
    expect(aguiProps?.useTeacherAuth).toBe(true);
  });

  it("prefixes the activity_id onto the sent message (the agent's contract)", async () => {
    render(<AuthoringCopilot activityId="act-42" onApplyLessonPrompt={vi.fn()} />);
    await screen.findByTestId("authoring-copilot");
    fireEvent.change(screen.getByLabelText(/beskriv hvad du vil undervise/i), { target: { value: "energi" } });
    fireEvent.submit(screen.getByRole("button", { name: /send/i }).closest("form")!);
    expect(sendMessage).toHaveBeenCalledWith("[activity_id=act-42] energi");
  });
});

describe("AuthoringCopilot — proposal card", () => {
  async function renderWithProposal(onApply = vi.fn()) {
    mockHook.toolCalls = [tc({ resultContent: PROPOSAL })];
    render(<AuthoringCopilot activityId="act-1" onApplyLessonPrompt={onApply} />);
    await screen.findByTestId("proposal-card");
    return onApply;
  }

  it("renders the proposed prompt + Apply applies it to the builder goal", async () => {
    const onApply = await renderWithProposal();
    expect(screen.getByText("Udforsk energibevarelse.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /anvend/i }));
    expect(onApply).toHaveBeenCalledWith("Udforsk energibevarelse.");
    expect(screen.getByRole("status")).toHaveTextContent(/anvendt/i);
  });

  it("Edit lets the teacher refine the text before applying", async () => {
    const onApply = await renderWithProposal();
    fireEvent.click(screen.getByRole("button", { name: /rediger/i }));
    fireEvent.change(screen.getByLabelText(/rediger lærer-prompt/i), { target: { value: "Min egen prompt" } });
    fireEvent.click(screen.getByRole("button", { name: /brug denne/i }));
    expect(onApply).toHaveBeenCalledWith("Min egen prompt");
  });

  it("Dismiss removes the card without applying", async () => {
    const onApply = await renderWithProposal();
    fireEvent.click(screen.getByRole("button", { name: /afvis/i }));
    expect(screen.queryByTestId("proposal-card")).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });
});
