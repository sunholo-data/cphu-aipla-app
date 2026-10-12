import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StreamingBubble } from "../StreamingBubble";
import type { SkillMessage } from "@/hooks/useSkillAgent";
import { BRANDING } from "@/lib/branding";

function makeMsg(content: string): SkillMessage {
  return { id: "msg-1", role: "assistant", content };
}

describe("StreamingBubble", () => {
  it("renders partial message content", () => {
    render(<StreamingBubble message={makeMsg("Hello wor")} skillId="test-skill" />);
    expect(screen.getByText(/hello wor/i)).toBeInTheDocument();
  });

  it("shows a blinking cursor", () => {
    const { container } = render(
      <StreamingBubble message={makeMsg("typing...")} skillId="test-skill" />,
    );
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("falls back to the skill id only when there is no persona or display name", () => {
    render(<StreamingBubble message={makeMsg("hi")} skillId="my-skill" />);
    expect(screen.getByText("my-skill")).toBeInTheDocument();
  });

  // 1.1.147 open question 6 — the streaming byline used to print the raw
  // skillId while the finished bubble showed the persona: a technical id
  // flickered on every turn.
  it("signs a streaming turn with the persona's name and face, not the skill id", () => {
    render(
      <StreamingBubble
        message={makeMsg("hi")}
        skillId="concept-dialogue"
        skillDisplayName="Concept dialogue"
        persona={{ id: "sofie", name: "Sofie", title: null, avatar: "/personas/sofie.png" }}
      />,
    );
    expect(screen.getByText("Sofie")).toBeInTheDocument();
    expect(screen.queryByText("concept-dialogue")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Sofie" })).toBeInTheDocument();
  });

  it("uses the skill display name when there is no persona", () => {
    render(<StreamingBubble message={makeMsg("hi")} skillId="concept-dialogue" skillDisplayName="Concept dialogue" />);
    expect(screen.getByText("Concept dialogue")).toBeInTheDocument();
    expect(screen.queryByText("concept-dialogue")).not.toBeInTheDocument();
  });

  it("renders the bot avatar with branded alt text", () => {
    render(<StreamingBubble message={makeMsg("hi")} skillId="s" />);
    expect(screen.getByRole("img", { name: BRANDING.appName })).toBeInTheDocument();
  });

  // 1.1.147 M0 — the stream renders Markdown + KaTeX, and the tail guard keeps
  // half-arrived maths or code from flashing as source.
  it("does not show an open $ formula's source mid-stream", () => {
    const { container } = render(
      <StreamingBubble message={makeMsg("Farten er $v = \\frac{s}{")} skillId="s" />,
    );
    expect(container.textContent).toContain("Farten er");
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toContain("\\frac");
  });

  it("does not show an open backtick span mid-stream", () => {
    const { container } = render(
      <StreamingBubble message={makeMsg("Energien `$E_{\\text{el")} skillId="s" />,
    );
    expect(container.textContent).toContain("Energien");
    expect(container.textContent).not.toContain("`");
    expect(container.textContent).not.toContain("\\text");
  });

  it("typesets a completed inline formula while still streaming", () => {
    const { container } = render(
      <StreamingBubble message={makeMsg("Farten er $v = \\frac{s}{t}$ og så")} skillId="s" />,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("applies orange left border class", () => {
    const { container } = render(
      <StreamingBubble message={makeMsg("hi")} skillId="s" />,
    );
    expect(container.querySelector(".border-orange-400")).toBeInTheDocument();
  });
});
