import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

// The test runner's bundled localStorage is unreliable here; back it with a
// plain Map so the threadId-persistence assertions are deterministic.
const memStore = new Map<string, string>();
const fakeStorage: Storage = {
  getItem: (k) => memStore.get(k) ?? null,
  setItem: (k, v) => void memStore.set(k, String(v)),
  removeItem: (k) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: () => null,
  length: 0,
};

import { TeacherCopilot } from "../TeacherCopilot";
import type { ProposalDescriptor } from "../types";
import type { ToolCallState, UseSkillAgentReturn } from "@/hooks/useSkillAgent";

vi.mock("@/providers/AGUIProvider", () => ({
  AGUIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

let resolver: { skillId: string | null; resolveError: string | null } = { skillId: "uuid-1", resolveError: null };
vi.mock("@/hooks/useSkillSlugResolver", () => ({ useSkillSlugResolver: () => resolver }));

const sendMessage = vi.fn().mockResolvedValue(undefined);
const defaultHook = {
  sessionId: "t",
  messages: [],
  toolCalls: [],
  thinkingContent: "",
  isThinking: false,
  stageLabel: null,
  sendMessage,
  isLoading: false,
  error: null,
  clearError: vi.fn(),
  stop: vi.fn(),
} as unknown as UseSkillAgentReturn;
let hook: UseSkillAgentReturn = defaultHook;
vi.mock("@/hooks/useSkillAgent", () => ({ useSkillAgent: () => hook }));

let sessionMessages: { initialMessages: unknown[] } = { initialMessages: [] };
vi.mock("@/hooks/useSessionMessages", () => ({ useSessionMessages: () => sessionMessages }));

type TestProposal = { kind: "make"; label: string; value: string };

const descriptor: ProposalDescriptor<TestProposal> = {
  title: (p) => `Make ${p.label}`,
  editableText: (p) => p.value,
  withEditedText: (p, text) => ({ ...p, value: text }),
};

const parseProposal = (tc: ToolCallState): TestProposal | null =>
  tc.status === "success" && tc.name === "make" ? { kind: "make", label: "9A", value: tc.argsJson ?? "" } : null;

function config(onApply = vi.fn()) {
  return {
    skillName: "manage-class",
    title: "Class co-pilot",
    scopePrefix: "[class_id=c1] ",
    placeholder: "Ask…",
    emptyText: "Tell me what to do.",
    parseProposal,
    proposalDescriptor: descriptor,
    onApplyProposal: onApply,
  };
}

function withTool(): ToolCallState[] {
  return [{ id: "t1", name: "make", status: "success", parentMessageId: "m1", argsJson: "Fysik 9A" } as ToolCallState];
}

beforeEach(() => {
  sendMessage.mockClear();
  resolver = { skillId: "uuid-1", resolveError: null };
  hook = { ...defaultHook, toolCalls: [] };
  sessionMessages = { initialMessages: [] };
  memStore.clear();
  vi.stubGlobal("localStorage", fakeStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeacherCopilot (shared shell)", () => {
  it("shows the loading state while the skill slug resolves", () => {
    resolver = { skillId: null, resolveError: null };
    render(<TeacherCopilot {...config()} />);
    expect(screen.getByTestId("copilot-loading")).toBeInTheDocument();
  });

  it("surfaces a slug-resolution error", () => {
    resolver = { skillId: null, resolveError: "not registered — run seed" };
    render(<TeacherCopilot {...config()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/run seed/i);
  });

  it("renders the floating panel and minimizes to a pill", () => {
    render(<TeacherCopilot {...config()} />);
    expect(screen.getByTestId("copilot-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /minimize/i }));
    expect(screen.getByTestId("copilot-fab")).toBeInTheDocument();
  });

  it("sends the message with the scope prefix and clears the input", async () => {
    render(<TeacherCopilot {...config()} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "make Fysik 9A" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage.mock.calls[0]![0]).toBe("[class_id=c1] make Fysik 9A");
    expect(input.value).toBe("");
  });

  it("renders a proposal card; Apply commits the proposal (propose-only)", () => {
    const onApply = vi.fn();
    hook = { ...defaultHook, toolCalls: withTool() };
    render(<TeacherCopilot {...config(onApply)} />);
    expect(screen.getByTestId("proposal-card")).toHaveTextContent("Make 9A");
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0]).toMatchObject({ kind: "make", value: "Fysik 9A" });
    expect(screen.getByRole("status")).toHaveTextContent(/applied/i);
  });

  it("Edit lets the teacher revise free text before applying", () => {
    const onApply = vi.fn();
    hook = { ...defaultHook, toolCalls: withTool() };
    render(<TeacherCopilot {...config(onApply)} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const ta = screen.getByRole("textbox", { name: /edit proposal/i }) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "Fysik 9B" } });
    fireEvent.click(screen.getByRole("button", { name: /use this/i }));
    expect(onApply.mock.calls[0]![0]).toMatchObject({ value: "Fysik 9B" });
  });

  it("dismissOnApply removes the card on Apply (no lingering badge)", () => {
    const onApply = vi.fn();
    hook = { ...defaultHook, toolCalls: withTool() };
    render(<TeacherCopilot {...config(onApply)} dismissOnApply />);
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    // No persistent "Applied ✓" badge — the card is gone (effect shows elsewhere).
    expect(screen.queryByTestId("proposal-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("Dismiss discards the proposal without applying", () => {
    const onApply = vi.fn();
    hook = { ...defaultHook, toolCalls: withTool() };
    render(<TeacherCopilot {...config(onApply)} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByTestId("proposal-card")).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("persists a threadId on mount (for cross-visit resume)", () => {
    render(<TeacherCopilot {...config()} />);
    expect(window.localStorage.getItem("teacherCopilot:manage-class")).toBeTruthy();
  });

  it("resumes: prior messages render before the live ones", () => {
    sessionMessages = {
      initialMessages: [{ id: "hist-1", role: "assistant", content: "Earlier turn", timestamp: 1 }],
    };
    hook = { ...defaultHook, messages: [{ id: "m1", role: "user", content: "live turn" }] as never };
    render(<TeacherCopilot {...config()} />);
    expect(screen.getByText("Earlier turn")).toBeInTheDocument();
    expect(screen.getByText("live turn")).toBeInTheDocument();
  });

  it("New chat resets the persisted thread to a fresh id", () => {
    render(<TeacherCopilot {...config()} />);
    const before = window.localStorage.getItem("teacherCopilot:manage-class");
    expect(before).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /new chat/i }));
    const after = window.localStorage.getItem("teacherCopilot:manage-class");
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
  });

  it("read-only mode (no parseProposal) renders chat with no proposal cards", () => {
    // The analytics co-pilot omits parseProposal/descriptor/onApplyProposal.
    hook = { ...defaultHook, toolCalls: withTool() };
    render(
      <TeacherCopilot
        skillName="analytics-chat"
        title="Analytics co-pilot"
        scopePrefix={`[class_id=c1] `}
        placeholder="Ask…"
        emptyText="Ask about this class."
      />,
    );
    // Even with a tool call present, no Apply card appears (nothing to apply).
    expect(screen.queryByTestId("proposal-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("teacher-copilot")).toBeInTheDocument();
  });
});
