import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AskAiplaButton } from "@/components/teacher/copilot/AskAiplaButton";
import { CopilotEntryProvider, useCopilotEntry } from "@/components/teacher/copilot/CopilotEntryContext";
import { FloatingCopilot } from "@/components/teacher/copilot/FloatingCopilot";

/**
 * 1.1.125 M3 — one entry to every copilot. Inside the shell a work copilot
 * registers with the header button and renders no pill; the button offers the
 * page's copilot and help. Outside a provider, nothing changes.
 */
describe("the one entry (AskAiplaButton + CopilotEntryProvider)", () => {
  it("opens help directly on a page with no work copilot", () => {
    const onOpenHelp = vi.fn();
    render(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled onOpenHelp={onOpenHelp} />
      </CopilotEntryProvider>,
    );
    fireEvent.click(screen.getByTestId("ask-aipla"));
    expect(onOpenHelp).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("carries a surface question through to the copilot and opens it (CONCEPT-2 M3)", () => {
    const onAsk = vi.fn();
    function SurfaceButton() {
      const entry = useCopilotEntry();
      return (
        <button type="button" onClick={() => entry?.ask("Foreslå et begrebskort")}>
          propose
        </button>
      );
    }
    render(
      <CopilotEntryProvider>
        <FloatingCopilot title="Medbygger" onAsk={onAsk}>
          <p>chat</p>
        </FloatingCopilot>
        <SurfaceButton />
      </CopilotEntryProvider>,
    );
    // The work copilot starts minimised; asking must open it, not send into a
    // panel the teacher cannot see.
    // `overflow-hidden` is on the panel at all times, so match the class as a
    // whole word rather than a substring.
    const classes = () => screen.getByTestId("copilot-panel").className.split(/\s+/);
    expect(classes()).toContain("hidden");
    fireEvent.click(screen.getByText("propose"));
    expect(onAsk).toHaveBeenCalledWith("Foreslå et begrebskort");
    expect(classes()).not.toContain("hidden");
  });

  it("reports that nothing was asked when no work copilot is mounted", () => {
    // The caller hides its button on false rather than offering a dead control.
    let result: boolean | undefined;
    function SurfaceButton() {
      const entry = useCopilotEntry();
      return (
        <button type="button" onClick={() => (result = entry?.ask("anything"))}>
          propose
        </button>
      );
    }
    render(
      <CopilotEntryProvider>
        <SurfaceButton />
      </CopilotEntryProvider>,
    );
    fireEvent.click(screen.getByText("propose"));
    expect(result).toBe(false);
  });

  it("renders nothing when help is off and no copilot registered — the header as it was", () => {
    const { container } = render(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled={false} onOpenHelp={() => {}} />
      </CopilotEntryProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("a work copilot inside the shell has no pill; the button offers it and help; choosing it expands the panel", () => {
    const onOpenHelp = vi.fn();
    render(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled onOpenHelp={onOpenHelp} />
        <FloatingCopilot title="Class co-pilot">
          <p>chat body</p>
        </FloatingCopilot>
      </CopilotEntryProvider>,
    );
    // No pill of its own; the panel starts hidden.
    expect(screen.queryByTestId("copilot-fab")).not.toBeInTheDocument();
    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(true);

    fireEvent.click(screen.getByTestId("ask-aipla"));
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent("Class co-pilot");
    expect(menu).toHaveTextContent("AIPLA Hjælp");
    fireEvent.click(screen.getByRole("menuitem", { name: /Class co-pilot/ }));
    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(false);
    expect(onOpenHelp).not.toHaveBeenCalled();

    // …and after minimising, the panel hides again with still no pill: the
    // header button is the way back in.
    fireEvent.click(screen.getByRole("button", { name: /minimize/i }));
    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(true);
    expect(screen.queryByTestId("copilot-fab")).not.toBeInTheDocument();
  });

  it("with help off, the button opens the page's copilot directly", () => {
    render(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled={false} onOpenHelp={() => {}} />
        <FloatingCopilot title="Authoring co-pilot">
          <p>chat body</p>
        </FloatingCopilot>
      </CopilotEntryProvider>,
    );
    fireEvent.click(screen.getByTestId("ask-aipla"));
    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(false);
  });

  it("unmounting the page's copilot clears the entry back to help-only", () => {
    const { rerender } = render(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled onOpenHelp={() => {}} />
        <FloatingCopilot title="Class co-pilot">
          <p>chat body</p>
        </FloatingCopilot>
      </CopilotEntryProvider>,
    );
    expect(screen.getByTestId("ask-aipla")).toHaveTextContent("Ask AIPLA");
    rerender(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled onOpenHelp={() => {}} />
      </CopilotEntryProvider>,
    );
    expect(screen.getByTestId("ask-aipla")).toHaveTextContent("Hjælp");
  });
});
