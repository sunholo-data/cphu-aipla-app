/**
 * Unit tests for the `_AnalyticsChat` island (sprint
 * ANALYTICS-CHAT-AND-INSIGHTS, M6).
 *
 * The chat hook (`useSkillAgent`) and the AG-UI provider are stubbed
 * — these tests cover the island's *behaviour*, not the streaming
 * transport (which has its own coverage under
 * `src/hooks/__tests__/useSkillAgent.test.tsx`).
 *
 * Properties under test:
 *
 * 1. Empty class id renders the "select a class" empty state.
 * 2. Suggested-question buttons prefill the input (no auto-submit).
 * 3. Submitting the form calls `sendMessage` with the scope-prefixed
 *    text and clears the input.
 * 4. Tool-call pills render with the right status data attribute.
 * 5. The "Show data" disclosure surfaces argsJson for each tool call.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { AnalyticsChat, SUGGESTED_QUESTIONS } from "@/app/teacher/analytics/_AnalyticsChat";
import type { SkillMessage, ToolCallState, UseSkillAgentReturn } from "@/hooks/useSkillAgent";

// AGUIProvider is a no-op in these tests — the hook is stubbed and
// doesn't actually need the AG-UI HttpAgent.
vi.mock("@/providers/AGUIProvider", () => ({
  AGUIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Skill UUID lookup goes through fetchWithTeacherAuth. Default to a
// successful resolution so each test's `await screen.findByRole(...)`
// proceeds past the "Loading chat…" placeholder; tests that want to
// exercise the resolution-error branch override with mockResolvedValueOnce.
vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ skillId: "test-uuid-analytics-chat" }),
  }),
}));

const sendMessage = vi.fn().mockResolvedValue(undefined);

const defaultHookValue: UseSkillAgentReturn = {
  sessionId: "thread-1",
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
};

let mockHook: UseSkillAgentReturn = defaultHookValue;

vi.mock("@/hooks/useSkillAgent", () => ({
  useSkillAgent: () => mockHook,
}));

function withHook(overrides: Partial<UseSkillAgentReturn>) {
  mockHook = { ...defaultHookValue, ...overrides };
}

beforeEach(() => {
  sendMessage.mockClear();
  withHook({});
});

// Helper: render and wait past the skill-resolution loading state so the
// chat is interactive. The empty-state test does NOT use this.
async function renderResolved(props: { classId: string; className: string; timeScope: string }) {
  render(<AnalyticsChat {...props} />);
  // Once the resolve promise settles, the "Loading chat…" placeholder
  // is replaced with the chat island.
  await waitFor(() => {
    expect(screen.queryByTestId("analytics-chat-loading")).not.toBeInTheDocument();
  });
}

describe("_AnalyticsChat", () => {
  it("renders the empty state when no class is selected", () => {
    render(<AnalyticsChat classId="" className="" timeScope="This week" />);
    expect(screen.getByText(/select a class above/i)).toBeInTheDocument();
    expect(screen.queryByTestId("analytics-chat")).not.toBeInTheDocument();
  });

  it("renders 'Loading chat…' while the skill UUID is being resolved", () => {
    render(<AnalyticsChat classId="c1" className="9A" timeScope="This week" />);
    expect(screen.getByTestId("analytics-chat-loading")).toBeInTheDocument();
  });

  it("surfaces a clear error when the analytics-chat skill is not registered", async () => {
    const apiClient = await import("@/lib/apiClient");
    (apiClient.fetchWithTeacherAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "not found" }),
    });
    render(<AnalyticsChat classId="c1" className="9A" timeScope="This week" />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/seed-platform-skills/i);
  });

  it("renders every suggested question as an enabled button", async () => {
    await renderResolved({ classId: "c1", className: "9A", timeScope: "This week" });
    for (const q of SUGGESTED_QUESTIONS) {
      const btn = screen.getByRole("button", { name: q });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    }
  });

  it("clicking a suggested question prefills the input but does NOT submit", async () => {
    await renderResolved({ classId: "c1", className: "9A", timeScope: "This week" });
    const q = SUGGESTED_QUESTIONS[0];
    fireEvent.click(screen.getByRole("button", { name: q }));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe(q);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("submitting the form sends a scope-prefixed message and clears the input", async () => {
    await renderResolved({ classId: "cls-42", className: "9A", timeScope: "This week" });
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "How many messages?" } });
    fireEvent.submit(input.closest("form")!);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [text] = sendMessage.mock.calls[0]!;
    expect(text).toBe(`[class_id=cls-42 time_scope="This week"] How many messages?`);
    expect(input.value).toBe("");
  });

  it("does not submit an empty input", async () => {
    await renderResolved({ classId: "c1", className: "9A", timeScope: "This week" });
    const input = screen.getByRole("textbox");
    fireEvent.submit(input.closest("form")!);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("renders tool-call pills with status data attribute", async () => {
    const msgs: SkillMessage[] = [{ id: "m1", role: "assistant", content: "Let me check." }];
    const tools: ToolCallState[] = [
      { id: "t1", name: "count_messages", status: "running", parentMessageId: "m1", argsJson: '{"class_id":"c1"}' },
    ];
    withHook({ messages: msgs, toolCalls: tools });
    await renderResolved({ classId: "c1", className: "9A", timeScope: "This week" });

    const pill = screen.getByTestId("tool-call-pill");
    expect(pill).toHaveTextContent("count_messages");
    expect(pill).toHaveAttribute("data-status", "running");
  });

  it("Show data disclosure surfaces argsJson for each tool call", async () => {
    const msgs: SkillMessage[] = [{ id: "m1", role: "assistant", content: "42 messages." }];
    const tools: ToolCallState[] = [
      { id: "t1", name: "count_messages", status: "success", parentMessageId: "m1", argsJson: '{"class_id":"c1","since":"7d"}' },
    ];
    withHook({ messages: msgs, toolCalls: tools });
    await renderResolved({ classId: "c1", className: "9A", timeScope: "This week" });

    expect(screen.getByText("Show data")).toBeInTheDocument();
    expect(screen.getByText(/"class_id":"c1"/)).toBeInTheDocument();
  });

  it("strips the scope prefix from rendered user bubbles", async () => {
    const msgs: SkillMessage[] = [
      { id: "u1", role: "user", content: `[class_id=cls-42 time_scope="This week"] How many?` },
    ];
    withHook({ messages: msgs });
    await renderResolved({ classId: "cls-42", className: "9A", timeScope: "This week" });
    expect(screen.getByText("How many?")).toBeInTheDocument();
    expect(screen.queryByText(/class_id=cls-42/)).not.toBeInTheDocument();
  });

  it("shows the stage label when loading", async () => {
    withHook({
      isLoading: true,
      stageLabel: "Calling count_messages…",
      messages: [{ id: "u1", role: "user", content: "Q?" }],
    });
    await renderResolved({ classId: "c1", className: "9A", timeScope: "This week" });
    expect(screen.getByTestId("loading-stage")).toHaveTextContent("Calling count_messages…");
  });

  it("renders an error banner when error is present", async () => {
    withHook({
      error: { kind: "run_error", message: "Backend hiccup", retryable: true, rawMessage: "x" },
    });
    await renderResolved({ classId: "c1", className: "9A", timeScope: "This week" });
    expect(screen.getByRole("alert")).toHaveTextContent("Backend hiccup");
  });
});
