import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { ChatMessageList } from "../ChatMessageList";
import type { SkillMessage } from "@/hooks/useSkillAgent";
import {
  HumanToolEventsProvider,
  useSeedRestoredInteractions,
  type HumanToolEvent,
} from "@/hooks/useHumanToolEvents";

// A2UIRenderer and MCPAppToolCallRouter mount external surfaces — stub them.
vi.mock("@/components/protocols/A2UIRenderer", () => ({
  A2UIRenderer: () => <div data-testid="a2ui-renderer" />,
}));
vi.mock("@/components/protocols/MCPAppToolCallRouter", () => ({
  MCPAppToolCallRouter: () => <div data-testid="mcp-app-router" />,
}));

const noOp = vi.fn();

const baseProps = {
  toolCalls: [],
  thinkingContent: "",
  isThinking: false,
  isLoading: false,
  error: null,
  skillId: "my-skill",
  userInitial: "M",
  userDisplayName: "Mark",
  onAction: noOp,
};

function msg(id: string, role: SkillMessage["role"], content: string): SkillMessage {
  return { id, role, content };
}

describe("ChatMessageList", () => {
  it("renders a placeholder when there are no messages", () => {
    render(<ChatMessageList messages={[]} {...baseProps} />);
    expect(screen.getByText(/send a message/i)).toBeInTheDocument();
  });

  it("maps N messages to N bubbles", () => {
    const messages = [
      msg("u1", "user", "Hi"),
      msg("a1", "assistant", "Hello!"),
      msg("u2", "user", "How are you?"),
    ];
    render(<ChatMessageList messages={messages} {...baseProps} />);
    expect(screen.getByText("Hi")).toBeInTheDocument();
    expect(screen.getByText("Hello!")).toBeInTheDocument();
    expect(screen.getByText("How are you?")).toBeInTheDocument();
  });

  it("shows TypingIndicator dots when isLoading with no assistant message yet", () => {
    const messages = [msg("u1", "user", "Hello")];
    const { container } = render(
      <ChatMessageList messages={messages} {...baseProps} isLoading={true} />,
    );
    // TypingIndicator has three animate-bounce dots when no tool is running
    expect(container.querySelectorAll(".animate-bounce")).toHaveLength(3);
  });

  it("shows tool name in TypingIndicator when a tool call is running", () => {
    const messages = [msg("u1", "user", "Hello")];
    render(
      <ChatMessageList
        messages={messages}
        {...baseProps}
        isLoading={true}
        toolCalls={[{ id: "tc1", name: "web_search", status: "running" }]}
      />,
    );
    expect(screen.getByText("web_search")).toBeInTheDocument();
  });

  it("shows StreamingBubble when last message is assistant and isLoading", () => {
    const messages = [
      msg("u1", "user", "Hello"),
      msg("a1", "assistant", "I am typing..."),
    ];
    const { container } = render(
      <ChatMessageList messages={messages} {...baseProps} isLoading={true} />,
    );
    // StreamingBubble has the animate-pulse cursor
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows ContextBanner when activeDocumentContext is provided", () => {
    render(
      <ChatMessageList
        messages={[]}
        {...baseProps}
        activeDocumentContext={{ folderName: "Q1 Docs", docCount: 5 }}
      />,
    );
    expect(screen.getByText(/q1 docs/i)).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("does not show ContextBanner when activeDocumentContext is undefined", () => {
    render(<ChatMessageList messages={[]} {...baseProps} />);
    expect(screen.queryByText(/analyzing/i)).toBeNull();
  });

  it("renders the errorBanner slot", () => {
    render(
      <ChatMessageList
        messages={[]}
        {...baseProps}
        errorBanner={<div>Stream error!</div>}
      />,
    );
    expect(screen.getByText("Stream error!")).toBeInTheDocument();
  });

  it("Bug G (chat-history-deep-fixes-3): an unparented tool call must NOT broadcast to every assistant bubble", () => {
    // Reproduces the user's report: "when we do a tool call, all chat
    // windows appear with the tool/results — not just the last one, that
    // did the toolcall."
    //
    // Pre-fix: ChatMessageList builds toolCallsByParent and falls back
    // every bubble that doesn't have its own keyed tool calls to the
    // SAME `__unparented__` array, so every assistant bubble renders the
    // same chip. Post-fix: unparented calls attach to the most recent
    // assistant message only (or none if no assistant exists yet).
    const messages = [
      msg("u1", "user", "first question"),
      msg("a1", "assistant", "first answer"),
      msg("u2", "user", "second question"),
      msg("a2", "assistant", "second answer"),
    ];
    render(
      <ChatMessageList
        messages={messages}
        {...baseProps}
        toolCalls={[
          // No parentMessageId — this is the bug class.
          { id: "tc-orphan", name: "web_search", status: "success" },
        ]}
      />,
    );

    // ToolCallChip renders the tool name as visible text. Pre-fix this
    // assertion fails because "web_search" appears in BOTH a1 and a2
    // bubbles (every non-keyed bubble falls back to __unparented__).
    const occurrences = screen.queryAllByText("web_search");
    expect(occurrences).toHaveLength(1);
  });

  describe("1.1.34 — restored MCP-app interaction cards", () => {
    const restoredCard = (afterMessageIndex: number, label = "RESTORED-CARD"): HumanToolEvent => ({
      id: `r-${afterMessageIndex}-${label}`,
      label,
      status: "confirmed",
      t: 1,
      afterMessageIndex,
      restored: true,
    });

    function withSeed(events: HumanToolEvent[], node: ReactElement) {
      function Harness() {
        useSeedRestoredInteractions(events);
        return node;
      }
      return render(
        <HumanToolEventsProvider>
          <Harness />
        </HumanToolEventsProvider>,
      );
    }

    it("renders a restored card interleaved in the history at its index", async () => {
      const initialMessages = [msg("h1", "user", "q1"), msg("h2", "assistant", "reaction")];
      withSeed(
        [restoredCard(1, "Sendte spoergsmaal med v0=15")],
        <ChatMessageList messages={[]} initialMessages={initialMessages} {...baseProps} />,
      );
      const card = await screen.findByText("Sendte spoergsmaal med v0=15");
      // lives in the RESTORED index space at index 1 (before the 2nd bubble)
      expect(screen.getByTestId("human-tool-events-at-restored-1")).toContainElement(card);
      // read-only = confirmed (no pending spinner / retry)
      expect(screen.getByTestId("human-tool-use-card").getAttribute("data-status")).toBe("confirmed");
    });

    it("keeps the restored and live card index spaces separate", async () => {
      withSeed(
        [restoredCard(0)],
        <ChatMessageList
          messages={[msg("L0", "user", "live msg")]}
          initialMessages={[msg("h0", "assistant", "history")]}
          {...baseProps}
        />,
      );
      const card = await screen.findByText("RESTORED-CARD");
      // under the restored container, NOT the live one at index 0
      expect(screen.getByTestId("human-tool-events-at-restored-0")).toContainElement(card);
      expect(screen.queryByTestId("human-tool-events-at-0")).toBeNull();
    });

    it("shows the truncated marker when interactionsTruncated is set", () => {
      render(
        <HumanToolEventsProvider>
          <ChatMessageList
            messages={[]}
            initialMessages={[msg("h1", "user", "q1")]}
            interactionsTruncated
            {...baseProps}
          />
        </HumanToolEventsProvider>,
      );
      expect(screen.getByText(/Tidligere interaktioner er skjult/)).toBeInTheDocument();
    });
  });
});
