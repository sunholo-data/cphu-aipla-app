import { describe, it, expect } from "vitest";
import { render as rtlRender, screen, act, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { LocaleProvider } from "@/i18n";
import { ThinkingPanel } from "@/components/chat/ThinkingPanel";

// 1.1.108: these assertions are about behaviour, written against the English
// labels — render under an English activity. The Danish default is covered by
// the component's own `da` assertions / i18n tests.
const EnglishActivity = ({ children }: { children: ReactNode }) => (
  <LocaleProvider locale="en">{children}</LocaleProvider>
);
const render = (ui: ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: EnglishActivity, ...options });


describe("ThinkingPanel", () => {
  it("renders thinking content", () => {
    render(<ThinkingPanel content="Analysing the query..." isThinking={true} />);
    expect(screen.getByText("Analysing the query...")).toBeTruthy();
  });

  it("shows Thinking… label when isThinking is true", () => {
    render(<ThinkingPanel content="working" isThinking={true} />);
    expect(screen.getByText("Thinking…")).toBeTruthy();
  });

  it("shows Thought process label when isThinking is false", () => {
    render(<ThinkingPanel content="done" isThinking={false} />);
    expect(screen.getByText("Thought process")).toBeTruthy();
  });

  it("auto-collapses (hides content) when isThinking transitions to false", () => {
    const { rerender } = render(
      <ThinkingPanel content="reasoning text" isThinking={true} />,
    );
    // Content visible while thinking
    expect(screen.getByText("reasoning text")).toBeTruthy();

    act(() => {
      rerender(<ThinkingPanel content="reasoning text" isThinking={false} />);
    });
    // Content hidden after collapse
    expect(screen.queryByText("reasoning text")).toBeFalsy();
  });

  it("toggle button expands and collapses content", () => {
    const { rerender } = render(
      <ThinkingPanel content="reasoning text" isThinking={true} />,
    );
    // Starts expanded — content visible
    expect(screen.getByText("reasoning text")).toBeTruthy();

    // Collapse via button click
    const btn = screen.getByRole("button");
    act(() => { btn.click(); });
    expect(screen.queryByText("reasoning text")).toBeFalsy();

    // Expand again
    act(() => { btn.click(); });
    expect(screen.getByText("reasoning text")).toBeTruthy();

    // If isThinking flips false while manually expanded — auto-collapses
    act(() => {
      rerender(<ThinkingPanel content="reasoning text" isThinking={false} />);
    });
    expect(screen.queryByText("reasoning text")).toBeFalsy();
  });
});
