/**
 * Unit tests for the `_ManageClassChat` island.
 *
 * Mirrors `_AnalyticsChat.test.tsx`: the chat hook (`useSkillAgent`) and
 * the AG-UI provider are stubbed, so these cover the island's behaviour,
 * not the streaming transport. The key difference from analytics is that
 * manage-class sends the typed text VERBATIM — there is no class-scope
 * prefix, because the skill's tools resolve the teacher server-side.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ManageClassChat, SUGGESTED_QUESTIONS } from "@/app/teacher/classes/assistant/_ManageClassChat";
import type { SkillMessage, ToolCallState, UseSkillAgentReturn } from "@/hooks/useSkillAgent";

vi.mock("@/providers/AGUIProvider", () => ({
  AGUIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ skillId: "test-uuid-manage-class" }),
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

async function renderResolved() {
  render(<ManageClassChat />);
  await waitFor(() => {
    expect(screen.queryByTestId("manage-class-loading")).not.toBeInTheDocument();
  });
}

describe("_ManageClassChat", () => {
  it("renders 'Loading chat…' while the skill UUID is being resolved", () => {
    render(<ManageClassChat />);
    expect(screen.getByTestId("manage-class-loading")).toBeInTheDocument();
  });

  it("surfaces a clear error when the manage-class skill is not registered", async () => {
    const apiClient = await import("@/lib/apiClient");
    (apiClient.fetchWithTeacherAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "not found" }),
    });
    render(<ManageClassChat />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/seed-platform-skills/i);
  });

  it("renders every suggestion as an enabled button", async () => {
    await renderResolved();
    for (const q of SUGGESTED_QUESTIONS) {
      const btn = screen.getByRole("button", { name: q });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    }
  });

  it("clicking a suggestion prefills the input but does NOT submit", async () => {
    await renderResolved();
    const q = SUGGESTED_QUESTIONS[0];
    fireEvent.click(screen.getByRole("button", { name: q }));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe(q);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("submitting the form sends the text VERBATIM (no scope prefix) and clears the input", async () => {
    await renderResolved();
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Create a class called Fysik 9A" } });
    fireEvent.submit(input.closest("form")!);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [text] = sendMessage.mock.calls[0]!;
    expect(text).toBe("Create a class called Fysik 9A");
    expect(input.value).toBe("");
  });

  it("does not submit an empty input", async () => {
    await renderResolved();
    const input = screen.getByRole("textbox");
    fireEvent.submit(input.closest("form")!);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("renders tool-call pills for create/mint with status data attribute", async () => {
    const msgs: SkillMessage[] = [{ id: "m1", role: "assistant", content: "Creating it now." }];
    const tools: ToolCallState[] = [
      { id: "t1", name: "create_class", status: "running", parentMessageId: "m1", argsJson: '{"name":"Fysik 9A"}' },
    ];
    withHook({ messages: msgs, toolCalls: tools });
    await renderResolved();

    const pill = screen.getByTestId("tool-call-pill");
    expect(pill).toHaveTextContent("create_class");
    expect(pill).toHaveAttribute("data-status", "running");
  });

  it("Show data disclosure surfaces argsJson", async () => {
    const msgs: SkillMessage[] = [{ id: "m1", role: "assistant", content: "Minted 3 codes." }];
    const tools: ToolCallState[] = [
      { id: "t1", name: "mint_group_codes", status: "success", parentMessageId: "m1", argsJson: '{"class_id":"c1","count":3}' },
    ];
    withHook({ messages: msgs, toolCalls: tools });
    await renderResolved();

    expect(screen.getByText("Show data")).toBeInTheDocument();
    expect(screen.getByText(/"count":3/)).toBeInTheDocument();
  });

  it("renders an error banner when error is present", async () => {
    withHook({
      error: { kind: "run_error", message: "Backend hiccup", retryable: true, rawMessage: "x" },
    });
    await renderResolved();
    expect(screen.getByRole("alert")).toHaveTextContent("Backend hiccup");
  });
});
