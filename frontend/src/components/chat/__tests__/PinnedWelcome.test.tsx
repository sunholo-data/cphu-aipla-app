import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { PinnedWelcome } from "../PinnedWelcome";

// Stub ChatMarkdown to keep the test fast and decoupled from KaTeX.
vi.mock("../ChatMarkdown", () => ({
  ChatMarkdown: ({ content }: { content: string }) => (
    <div data-testid="markdown-stub">{content}</div>
  ),
}));

const KEY = "aipla.welcome.collapsed:skill-1";

describe("PinnedWelcome", () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(KEY);
  });

  it("renders content expanded by default", () => {
    render(<PinnedWelcome content="welcome body" skillId="skill-1" />);
    expect(screen.getByTestId("markdown-stub")).toHaveTextContent("welcome body");
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });

  it("returns null when content is empty", () => {
    const { container } = render(<PinnedWelcome content="" skillId="skill-1" />);
    expect(container.firstChild).toBeNull();
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

  it("scopes state by skillId so toggling one skill doesn't affect another", () => {
    const { unmount } = render(<PinnedWelcome content="a" skillId="skill-1" />);
    fireEvent.click(screen.getByRole("button"));
    expect(window.sessionStorage.getItem(KEY)).toBe("1");
    unmount();
    // Different skill: starts expanded regardless of skill-1's state
    render(<PinnedWelcome content="b" skillId="skill-2" />);
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });
});
