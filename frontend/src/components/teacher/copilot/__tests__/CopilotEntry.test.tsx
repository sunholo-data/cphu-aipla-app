import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AskAiplaButton } from "@/components/teacher/copilot/AskAiplaButton";
import { CopilotEntryProvider, useCopilotEntry } from "@/components/teacher/copilot/CopilotEntryContext";
import { FloatingCopilot } from "@/components/teacher/copilot/FloatingCopilot";

// 1.1.108 M2 — these tests assert the English copy; a teacher's default
// language is Danish, so render inside an English locale.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const r = rtlRender(wrap(ui), options);
  return { ...r, rerender: (next: ReactElement) => r.rerender(wrap(next)) };
}

/**
 * 1.1.125 M3 — one entry to every copilot. Inside the shell a work copilot
 * registers with the header Help menu and renders no pill; the menu offers the
 * page's copilot, help and the guides. Outside a provider, nothing changes.
 */
describe("the one entry (AskAiplaButton + CopilotEntryProvider)", () => {
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


  // UI sweep 2026-11-11 — Guides left the nav for this menu, so the menu must
  // render even when there is nothing else in it.
  it("with help off and no page copilot, still renders — the guides are reachable from it", async () => {
    render(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled={false} onOpenHelp={() => {}} />
      </CopilotEntryProvider>,
    );
    await userEvent.click(screen.getByTestId("ask-aipla"));
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Guides");
    expect(items[0]).toHaveAttribute("href", "/guides");
  });

  it("with help on and no page copilot, offers Guides and Ask AIPLA Help; choosing help opens it", async () => {
    const onOpenHelp = vi.fn();
    render(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled onOpenHelp={onOpenHelp} />
      </CopilotEntryProvider>,
    );
    expect(screen.getByTestId("ask-aipla")).toHaveTextContent("Help");
    await userEvent.click(screen.getByTestId("ask-aipla"));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      expect.stringContaining("Guides"),
      expect.stringContaining("Ask AIPLA Help"),
    ]);
    await userEvent.click(screen.getByRole("menuitem", { name: /Ask AIPLA Help/ }));
    expect(onOpenHelp).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is a real menu: opens from the keyboard and closes on Escape", async () => {
    render(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled onOpenHelp={() => {}} />
      </CopilotEntryProvider>,
    );
    screen.getByTestId("ask-aipla").focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("a work copilot inside the shell shows its pill AND is in the menu beside help; choosing it expands the panel", async () => {
    const onOpenHelp = vi.fn();
    render(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled onOpenHelp={onOpenHelp} />
        <FloatingCopilot title="Class co-pilot">
          <p>chat body</p>
        </FloatingCopilot>
      </CopilotEntryProvider>,
    );
    // Its pill is visible (2026-11-12: the menu alone hid it); the panel starts hidden.
    expect(screen.getByTestId("copilot-fab")).toHaveTextContent("Class co-pilot");
    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(true);

    await userEvent.click(screen.getByTestId("ask-aipla"));
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent("Guides");
    expect(menu).toHaveTextContent("Class co-pilot");
    expect(menu).toHaveTextContent("AIPLA Help");
    await userEvent.click(screen.getByRole("menuitem", { name: /Class co-pilot/ }));
    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(false);
    expect(onOpenHelp).not.toHaveBeenCalled();
    // The pill hides while the panel is open: the panel is where it was.
    expect(screen.queryByTestId("copilot-fab")).not.toBeInTheDocument();

    // …and after minimising, the panel hides and the pill is back.
    await userEvent.click(screen.getByRole("button", { name: /minimize/i }));
    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(true);
    expect(screen.getByTestId("copilot-fab")).toBeInTheDocument();
  });

  it("with help off, the menu still offers the page's copilot (and the guides)", async () => {
    render(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled={false} onOpenHelp={() => {}} />
        <FloatingCopilot title="Authoring co-pilot">
          <p>chat body</p>
        </FloatingCopilot>
      </CopilotEntryProvider>,
    );
    await userEvent.click(screen.getByTestId("ask-aipla"));
    expect(screen.queryByRole("menuitem", { name: /AIPLA Help/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Guides/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: /Authoring co-pilot/ }));
    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(false);
  });

  it("unmounting the page's copilot takes it out of the menu", async () => {
    const { rerender } = render(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled onOpenHelp={() => {}} />
        <FloatingCopilot title="Class co-pilot">
          <p>chat body</p>
        </FloatingCopilot>
      </CopilotEntryProvider>,
    );
    await userEvent.click(screen.getByTestId("ask-aipla"));
    expect(screen.getByRole("menuitem", { name: /Class co-pilot/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    rerender(
      <CopilotEntryProvider>
        <AskAiplaButton helpEnabled onOpenHelp={() => {}} />
      </CopilotEntryProvider>,
    );
    await userEvent.click(screen.getByTestId("ask-aipla"));
    expect(screen.queryByRole("menuitem", { name: /Class co-pilot/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });
});
