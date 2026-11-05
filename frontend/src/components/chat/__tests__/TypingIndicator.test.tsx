import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/i18n";
import { TypingIndicator } from "../TypingIndicator";
import { BRANDING } from "@/lib/branding";

describe("TypingIndicator", () => {
  it("renders three animated dots when no tool is active", () => {
    const { container } = render(<TypingIndicator />);
    const dots = container.querySelectorAll(".animate-bounce");
    expect(dots).toHaveLength(3);
  });

  it("renders the bot avatar image with branded alt text", () => {
    render(<TypingIndicator />);
    expect(screen.getByRole("img", { name: BRANDING.appName })).toBeInTheDocument();
  });

  it("shows tool name when activeToolName is provided", () => {
    render(<TypingIndicator activeToolName="web_search" />);
    expect(screen.getByText("web_search")).toBeInTheDocument();
    expect(screen.queryAllByRole("presentation").length).toBeGreaterThanOrEqual(0);
  });

  it("hides three dots when activeToolName is provided", () => {
    const { container } = render(<TypingIndicator activeToolName="list_documents" />);
    expect(container.querySelectorAll(".animate-bounce")).toHaveLength(0);
  });

  // ttft-instrumentation.md M2: STAGE_PROGRESS labels surface the
  // backend's per-stage progress (Reading 2 documents…, Thinking…,
  // Calling search…) inside the typing indicator before any model
  // token lands. Decouples perceived TTFT from real model TTFT.
  describe("stageLabel (server-authored stage progress)", () => {
    it("renders stageLabel when provided", () => {
      render(<TypingIndicator stageLabel="Reading 2 documents…" />);
      expect(screen.getByText("Reading 2 documents…")).toBeInTheDocument();
    });

    it("hides three dots when stageLabel is provided", () => {
      const { container } = render(<TypingIndicator stageLabel="Thinking…" />);
      expect(container.querySelectorAll(".animate-bounce")).toHaveLength(0);
    });

    it("stageLabel takes priority over activeToolName", () => {
      // The server-authored label is canonical — if the backend has
      // emitted a STAGE_PROGRESS, that's what the user should see,
      // not the local toolName fallback.
      render(<TypingIndicator stageLabel="Calling web_search…" activeToolName="other_tool" />);
      expect(screen.getByText("Calling web_search…")).toBeInTheDocument();
      expect(screen.queryByText("other_tool")).not.toBeInTheDocument();
    });

    it("falls back to activeToolName when stageLabel is null", () => {
      render(<TypingIndicator stageLabel={null} activeToolName="ai_search" />);
      expect(screen.getByText("ai_search")).toBeInTheDocument();
    });

    it("falls back to dots when both stageLabel and activeToolName are absent", () => {
      const { container } = render(<TypingIndicator stageLabel={null} />);
      expect(container.querySelectorAll(".animate-bounce")).toHaveLength(3);
    });
  });

  // Ported from platform-source's UI audit (2026-11-03): a slow start must
  // never read as a hang. Copy lives in messages/{da,en}/chat.json.
  describe("a long wait says so in words", () => {
    afterEach(() => vi.useRealTimers());

    it("says nothing for the first few seconds, then 'working', then 'still working'", () => {
      vi.useFakeTimers();
      render(
        <LocaleProvider locale="en">
          <TypingIndicator />
        </LocaleProvider>,
      );
      expect(screen.queryByText("Working on it…")).toBeNull();
      act(() => vi.advanceTimersByTime(5_000));
      expect(screen.getByText("Working on it…")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(15_000));
      expect(screen.getByText("Still working…")).toBeInTheDocument();
      expect(screen.queryByText("Working on it…")).toBeNull();
    });

    it("speaks the activity's language (Danish by default)", () => {
      vi.useFakeTimers();
      render(<TypingIndicator />);
      act(() => vi.advanceTimersByTime(5_000));
      expect(screen.getByText("Arbejder på det…")).toBeInTheDocument();
    });

    it("announces itself politely to screen readers", () => {
      render(<TypingIndicator />);
      expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    });

    it("its own dots use the brand colour, not the inherited orange", () => {
      // Scoped to the indicator's dots: BrandAvatar still carries the template's
      // orange gradient (noted in docs/notes-2026-11-05.md, upstream review).
      const { container } = render(<TypingIndicator />);
      const dots = container.querySelectorAll(".animate-bounce");
      dots.forEach((d) => expect(d.className).toContain("bg-primary"));
      dots.forEach((d) => expect(d.className).not.toMatch(/orange-/));
    });
  });
});
