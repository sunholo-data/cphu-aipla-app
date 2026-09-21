import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AskAiplaButton } from "@/components/teacher/copilot/AskAiplaButton";
import { CopilotEntryProvider } from "@/components/teacher/copilot/CopilotEntryContext";
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
