import { act, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
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

// 1.1.108 M2 — these tests assert the English copy; a teacher's default
// language is Danish, so render inside an English locale.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const r = rtlRender(wrap(ui), options);
  return { ...r, rerender: (next: ReactElement) => r.rerender(wrap(next)) };
}

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

const fetchWithTeacherAuth = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: (...args: unknown[]) => fetchWithTeacherAuth(...args),
}));

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
  it("shows the model's streamed thinking while it works", () => {
    hook = {
      ...defaultHook,
      isLoading: true,
      thinkingContent: "Planning the pendulum: the bob position comes from theta(t) by RK4…",
    } as unknown as UseSkillAgentReturn;
    render(<TeacherCopilot {...config()} />);
    expect(screen.getByTestId("copilot-thinking")).toHaveTextContent("Planning the pendulum");
  });

  it("docks as a page column when asked (the Sim workshop), with the same chat and New chat", () => {
    hook = defaultHook;
    render(<TeacherCopilot {...config()} docked />);
    expect(screen.getByTestId("docked-copilot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new chat/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows the server's progress stage while busy, in the teacher's language for known keys", () => {
    hook = {
      ...defaultHook,
      isLoading: true,
      stage: { label: "Checking version 2 in the browser…", key: "simChecking", params: { version: 2 } },
    } as unknown as UseSkillAgentReturn;
    render(<TeacherCopilot {...config()} />);
    expect(screen.getByTestId("copilot-progress")).toHaveTextContent("Checking version 2 in the browser…");
  });

  it("falls back to the server's label for an unknown stage, and to Thinking with none", () => {
    hook = {
      ...defaultHook,
      isLoading: true,
      stage: { label: "Reading 2 documents…", key: "readingDocuments", params: {} },
    } as unknown as UseSkillAgentReturn;
    const { rerender } = render(<TeacherCopilot {...config()} />);
    expect(screen.getByTestId("copilot-progress")).toHaveTextContent("Reading 2 documents…");
    hook = { ...defaultHook, isLoading: true, stage: null } as unknown as UseSkillAgentReturn;
    rerender(<TeacherCopilot {...config()} />);
    expect(screen.getByTestId("copilot-progress")).toHaveTextContent("Thinking…");
  });

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
    // 1.1.108 — the teacher's language rides first, then the surface's scope.
    expect(sendMessage.mock.calls[0]![0]).toBe("[ui_language=en] [class_id=c1] make Fysik 9A");
    expect(input.value).toBe("");
  });

  it("omits the help link by default", () => {
    render(<TeacherCopilot {...config()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a persistent help link when the surface configures one, even with no messages yet", () => {
    render(<TeacherCopilot {...config()} helpLink={{ href: "mailto:x@y.dk?subject=hi", label: "Report a bug" }} />);
    const link = screen.getByRole("link", { name: "Report a bug" });
    expect(link).toHaveAttribute("href", "mailto:x@y.dk?subject=hi");
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

  it("auto-clears the Applied ✓ badge so confirmations don't pile up", () => {
    vi.useFakeTimers();
    try {
      const onApply = vi.fn();
      hook = { ...defaultHook, toolCalls: withTool() };
      render(<TeacherCopilot {...config(onApply)} />);
      fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
      expect(screen.getByRole("status")).toHaveTextContent(/applied/i);
      // …and it clears itself shortly after (no lingering column of badges).
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByTestId("proposal-card")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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

  it("never shows the language tag in the teacher's own bubble (1.1.108)", () => {
    hook = { ...defaultHook, messages: [{ id: "m1", role: "user", content: "[ui_language=en] what now?" }] as never };
    render(<TeacherCopilot {...config()} />);
    expect(screen.getByText("what now?")).toBeInTheDocument();
    expect(screen.queryByText(/ui_language/)).not.toBeInTheDocument();
  });

  it("hides the language tag when the model echoes it at the start of a reply", () => {
    hook = {
      ...defaultHook,
      messages: [{ id: "m1", role: "assistant", content: "[ui_language=da] Der står Fig. 1." }] as never,
    };
    render(<TeacherCopilot {...config()} />);
    expect(screen.getByText("Der står Fig. 1.")).toBeInTheDocument();
    expect(screen.queryByText(/ui_language/)).not.toBeInTheDocument();
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

  it("skips empty-content message bubbles (AG-UI tool-call turns)", () => {
    // A tool-call-only assistant turn arrives with empty content; the proposal
    // card stands in for it, so it must NOT render as an empty bubble.
    hook = {
      ...defaultHook,
      messages: [
        { id: "m1", role: "assistant", content: "" },
        { id: "m2", role: "assistant", content: "Here is my proposal." },
      ] as never,
    };
    render(<TeacherCopilot {...config()} />);
    expect(screen.getByText("Here is my proposal.")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
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

describe("TeacherCopilot on a phone, and after a dropped connection", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage);
    fetchWithTeacherAuth.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("docked: a launcher opens the chat as a sheet, and the chat stays mounted when it closes", () => {
    render(<TeacherCopilot {...config()} docked />);
    const launcher = screen.getByTestId("docked-copilot-launcher");
    const panel = screen.getByTestId("docked-copilot");
    expect(panel.className).toMatch(/(^| )hidden( |$)/);
    expect(panel.className).toContain("lg:flex");
    fireEvent.click(launcher);
    expect(panel.className).toContain("fixed inset-0");
    expect(launcher.className).toMatch(/(^| )hidden( |$)/);
    fireEvent.click(screen.getByTestId("docked-copilot-close"));
    expect(panel.className).toMatch(/(^| )hidden( |$)/);
    // Hidden, not unmounted: a build keeps streaming while the teacher looks at the sim.
    expect(screen.getByTestId("teacher-copilot")).toBeInTheDocument();
  });

  it("docked: a page's focus request opens the sheet on the new thread and puts the cursor in the chat", async () => {
    const { rerender } = render(<TeacherCopilot {...config()} docked persistKey="k" />);
    const panel = screen.getByTestId("docked-copilot");
    // A plain resume (picking a draft) leaves the sheet shut: the teacher wanted the sim.
    rerender(<TeacherCopilot {...config()} docked persistKey="k" resume={{ threadId: "t-old", seq: 1 }} />);
    expect(panel.className).toMatch(/(^| )hidden( |$)/);
    rerender(
      <TeacherCopilot {...config()} docked persistKey="k" resume={{ threadId: "t-new", seq: 2, focus: true }} />,
    );
    expect(panel.className).toContain("fixed inset-0");
    expect(localStorage.getItem("teacherCopilot:k")).toBe("t-new");
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole("textbox")));
  });

  it("docked: the launcher says when the assistant is working", () => {
    hook = { ...defaultHook, isLoading: true };
    render(<TeacherCopilot {...config()} docked />);
    expect(screen.getByTestId("docked-copilot-launcher")).toHaveTextContent("Working…");
  });

  it("a lost connection waits for the server's run instead of asking to try again", async () => {
    fetchWithTeacherAuth
      .mockResolvedValueOnce({ ok: true, json: async () => ({ running: true }) })
      .mockResolvedValue({ ok: true, json: async () => ({ running: false }) });
    hook = {
      ...defaultHook,
      error: { kind: "network", code: "connectionLost", message: "Connection lost. Try again.", retryable: true },
    } as UseSkillAgentReturn;
    render(<TeacherCopilot {...config()} persistKey="k" />);
    expect(await screen.findByTestId("copilot-still-working")).toBeInTheDocument();
    expect(screen.queryByText("Connection lost. Try again.")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchWithTeacherAuth).toHaveBeenCalledTimes(1));
    expect(fetchWithTeacherAuth.mock.calls[0][0]).toMatch(/^\/api\/proxy\/api\/skill-runs\//);
  });

  it("a send refused while the last turn runs goes back in the box", async () => {
    fetchWithTeacherAuth.mockResolvedValue({ ok: true, json: async () => ({ running: true }) });
    const clearTurnRefused = vi.fn();
    hook = {
      ...defaultHook,
      turnRefused: "[ui_language=en] [class_id=c1] make it blue",
      clearTurnRefused,
    } as unknown as UseSkillAgentReturn;
    render(<TeacherCopilot {...config()} stripPrefix={(c: string) => c.replace("[class_id=c1] ", "")} />);
    await waitFor(() => expect(clearTurnRefused).toHaveBeenCalled());
    expect(screen.getByRole("textbox")).toHaveValue("make it blue");
    expect(screen.getByTestId("copilot-still-working")).toHaveTextContent(/still running/);
  });
});
