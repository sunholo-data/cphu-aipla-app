import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SkillMessage } from "@/hooks/useSkillAgent";

// Capture the `autoSpeakAllowed` prop per bubble instead of rendering the real
// TTS chain. This guards the auto-read WIRING — that exactly ONE bubble (the
// latest assistant turn across restored history + live messages) is designated
// to speak. The regression: restored history rendered N assistant bubbles and
// every one self-spoke, so all the audio played at once on reload.
vi.mock("../MessageBubble", () => ({
  MessageBubble: ({
    message,
    autoSpeakAllowed,
  }: {
    message: SkillMessage;
    autoSpeakAllowed?: boolean;
  }) => (
    <div
      data-testid="bubble"
      data-content={message.content}
      data-role={message.role}
      data-autospeak={String(!!autoSpeakAllowed)}
    />
  ),
}));

import { ChatMessageList } from "../ChatMessageList";

const base = {
  toolCalls: [],
  thinkingContent: "",
  isThinking: false,
  isLoading: false,
  error: null,
  skillId: "s",
  userInitial: "M",
  userDisplayName: "Mark",
  onAction: vi.fn(),
};

const m = (id: string, role: SkillMessage["role"], content: string): SkillMessage => ({
  id,
  role,
  content,
});

/** Contents of the bubbles wired to auto-read (data-autospeak="true"). */
function speakingContents(): string[] {
  return Array.from(
    document.querySelectorAll('[data-testid="bubble"][data-autospeak="true"]'),
  ).map((el) => el.getAttribute("data-content") ?? "");
}

describe("ChatMessageList — auto-read designates only the latest assistant turn", () => {
  it("on reload (restored history, no live turns) only the LAST assistant auto-reads", () => {
    render(
      <ChatMessageList
        messages={[]}
        initialMessages={[
          m("h1", "assistant", "greet"),
          m("h2", "user", "hi"),
          m("h3", "assistant", "reply"),
        ]}
        {...base}
      />,
    );
    // All restored bubbles render…
    expect(screen.getAllByTestId("bubble")).toHaveLength(3);
    // …but exactly one auto-reads, and it's the LAST assistant ("reply"), not
    // the greet. Pre-fix, both "greet" and "reply" would have spoken at once.
    expect(speakingContents()).toEqual(["reply"]);
  });

  it("prefers the latest LIVE assistant turn over restored history", () => {
    render(
      <ChatMessageList
        messages={[m("l1", "user", "new q"), m("l2", "assistant", "new answer")]}
        initialMessages={[
          m("h1", "assistant", "old greet"),
          m("h2", "assistant", "old reply"),
        ]}
        {...base}
      />,
    );
    expect(speakingContents()).toEqual(["new answer"]);
  });

  it("nothing auto-reads when only the student has spoken", () => {
    render(<ChatMessageList messages={[m("u1", "user", "hi")]} {...base} />);
    expect(speakingContents()).toEqual([]);
  });
});
