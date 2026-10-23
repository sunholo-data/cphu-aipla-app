import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { PinnedWelcome } from "../PinnedWelcome";
import { LocaleProvider } from "@/i18n";
import type { ActivityOpening } from "@/lib/activityOpening";

// Stub ChatMarkdown to keep the test fast and decoupled from KaTeX.
vi.mock("../ChatMarkdown", () => ({
  ChatMarkdown: ({ content }: { content: string }) => (
    <div data-testid="markdown-stub">{content}</div>
  ),
}));

const KEY = "aipla.welcome.collapsed:skill-1";
const opening: ActivityOpening = {
  text: "", source: "default", firstItem: { kind: "simulation", title: "Elkedel" },
  steps: ["Mål tiden", "Beregn energien"], starterPrompts: [], byTeacher: false,
};

describe("PinnedWelcome", () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(KEY);
  });

  it("renders content expanded by default", () => {
    render(<PinnedWelcome content="welcome body" skillId="skill-1" />);
    expect(screen.getByTestId("markdown-stub")).toHaveTextContent("welcome body");
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });

  it("still shows the privacy notice when the teacher wrote no welcome text", () => {
    render(<PinnedWelcome content="" skillId="skill-1" />);
    expect(screen.getByRole("note")).toHaveTextContent(/CPR/);
    expect(screen.queryByTestId("markdown-stub")).not.toBeInTheDocument();
  });

  it("keeps the privacy notice visible when the box is collapsed", () => {
    render(<PinnedWelcome content="welcome body" skillId="skill-1" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByTestId("markdown-stub")).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("collapses on toggle and hides the body", () => {
    render(<PinnedWelcome content="welcome body" skillId="skill-1" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByTestId("markdown-stub")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
  });

  it("persists collapse state to sessionStorage per skillId", () => {
    render(<PinnedWelcome content="welcome body" skillId="skill-1" />);
    fireEvent.click(screen.getByRole("button"));
    expect(window.sessionStorage.getItem(KEY)).toBe("1");
    fireEvent.click(screen.getByRole("button"));
    expect(window.sessionStorage.getItem(KEY)).toBe("0");
  });

  it("restores collapsed state from sessionStorage on mount", () => {
    window.sessionStorage.setItem(KEY, "1");
    render(<PinnedWelcome content="welcome body" skillId="skill-1" />);
    expect(screen.queryByTestId("markdown-stub")).not.toBeInTheDocument();
  });

  it("renders the persona column (avatar + name + role) alongside the content", () => {
    render(
      <PinnedWelcome
        content="welcome body"
        skillId="skill-1"
        persona={{ id: "p1", name: "Mikkel", title: "Lab-demonstrator", avatar: "https://x/a.png" }}
      />,
    );
    const avatar = screen.getByAltText("Mikkel");
    expect(avatar).toBeInTheDocument();
    expect(screen.getByText("Mikkel")).toBeInTheDocument();
    expect(screen.getByText("Lab-demonstrator")).toBeInTheDocument();
    // Content still renders beside the persona column.
    expect(screen.getByTestId("markdown-stub")).toHaveTextContent("welcome body");
  });

  it("falls back to an initial when the persona has no avatar", () => {
    render(
      <PinnedWelcome
        content="welcome body"
        skillId="skill-1"
        persona={{ id: "p1", name: "Mikkel", title: null, avatar: "" }}
      />,
    );
    expect(screen.queryByAltText("Mikkel")).not.toBeInTheDocument();
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("scopes state by skillId so toggling one skill doesn't affect another", () => {
    const { unmount } = render(<PinnedWelcome content="a" skillId="skill-1" />);
    fireEvent.click(screen.getByRole("button"));
    expect(window.sessionStorage.getItem(KEY)).toBe("1");
    unmount();
    // Different skill: starts expanded regardless of skill-1's state
    render(<PinnedWelcome content="b" skillId="skill-2" />);
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });

  it("replaces generic skill text with activity facts and a Danish guide", () => {
    render(<PinnedWelcome content="generic concept dialogue" skillId="skill-1" opening={opening} activityTitle="Energi" />);
    expect(screen.queryByTestId("markdown-stub")).not.toBeInTheDocument();
    expect(screen.getByText("Energi")).toBeInTheDocument();
    expect(screen.getByText("Start med: Elkedel")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(opening.steps);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/guides/s1-join-and-use-your-tutor.da");
  });

  it("renders teacher Markdown verbatim and sends the exact custom prompt", () => {
    const send = vi.fn();
    render(<PinnedWelcome content="generic" skillId="skill-1" activityTitle="Hidden default title"
      opening={{ ...opening, text: "**Teacher's instructions**", source: "teacher", starterPrompts: ["What do I measure?"] }}
      onStarterPrompt={send} />);
    expect(screen.getByTestId("markdown-stub")).toHaveTextContent("**Teacher's instructions**");
    expect(screen.queryByText("Hidden default title")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "What do I measure?" }));
    expect(send).toHaveBeenCalledExactlyOnceWith("What do I measure?");
  });

  it("offers localised defaults when no starter prompts were authored and disables them during a turn", () => {
    const send = vi.fn();
    render(<LocaleProvider locale="en"><PinnedWelcome content="" skillId="skill-1" opening={opening}
      onStarterPrompt={send} promptsDisabled /></LocaleProvider>);
    expect(screen.getByRole("button", { name: "What should I start with?" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Can you give an example?" })).toBeDisabled();
    expect(send).not.toHaveBeenCalled();
  });

  it("localises an English activity, including an untitled element and the tutor's name", () => {
    render(
      <LocaleProvider locale="en">
        <PinnedWelcome content="Danish skill text" skillId="skill-1"
          opening={{ ...opening, firstItem: { kind: "table", title: "" }, steps: [] }}
          persona={{ id: "p1", name: "Mikkel", title: null, avatar: "" }} />
      </LocaleProvider>,
    );
    expect(screen.getByText("Start with: the table")).toBeInTheDocument();
    expect(screen.getByText("Stuck? Ask Mikkel for help with your next step.")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/guides/s1-join-and-use-your-tutor");
  });

  it("shows the first checklist step when it is the only workspace item", () => {
    render(<PinnedWelcome content="generic" skillId="skill-1"
      opening={{ ...opening, firstItem: { kind: "checklist", title: "Mål tiden" } }} />);
    expect(screen.getByText("Start med: Mål tiden")).toBeInTheDocument();
  });

  it("gives a chat-only activity a concrete way to begin", () => {
    render(<PinnedWelcome content="generic" skillId="skill-1"
      opening={{ ...opening, firstItem: null, steps: [] }} />);
    expect(screen.getByText(/Start med at fortælle tutoren/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("keeps separate collapse state for activities using the same skill", () => {
    const { rerender } = render(<PinnedWelcome content="generic" skillId="skill-1" activityId="act-a" opening={opening} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toBeInTheDocument();
    rerender(<PinnedWelcome content="generic" skillId="skill-1" activityId="act-b" opening={opening} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
    rerender(<PinnedWelcome content="generic" skillId="skill-1" activityId="act-a" opening={opening} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    window.sessionStorage.removeItem("aipla.welcome.collapsed:act-a");
  });
});
