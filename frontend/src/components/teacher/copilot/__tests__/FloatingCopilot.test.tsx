import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FloatingCopilot } from "@/components/teacher/copilot/FloatingCopilot";

describe("FloatingCopilot — the panel every co-pilot shares", () => {
  it("starts MINIMISED, as a pill", async () => {
    // M's standing request (2026-09-11). These panels sit over the surface the
    // teacher is working on; opening expanded puts 384px of chat over that work
    // on every page load, before anyone asked for help.
    render(
      <FloatingCopilot title="Class co-pilot">
        <p>chat body</p>
      </FloatingCopilot>,
    );

    expect(screen.getByTestId("copilot-fab")).toBeInTheDocument();
    // ⚠️ classList, not className.toContain("hidden") — the panel also carries
    // `overflow-hidden`, so a substring check passes whatever the state is.
    // Hidden by class, not unmounted: collapsing must never lose the
    // conversation, so the body stays in the DOM.
    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(true);
    expect(screen.getByText("chat body")).toBeInTheDocument();
  });

  it("expands when the pill is clicked, and the pill goes", async () => {
    const user = userEvent.setup();
    render(
      <FloatingCopilot title="Class co-pilot">
        <p>chat body</p>
      </FloatingCopilot>,
    );

    await user.click(screen.getByTestId("copilot-fab"));

    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(false);
    expect(screen.queryByTestId("copilot-fab")).not.toBeInTheDocument();
  });

  it("an ON-DEMAND panel opens expanded, because the teacher just clicked to open it", () => {
    // `closable` panels are mounted by a header button. Collapsing one to a pill
    // would swallow the click that opened it — so the minimised default must
    // not reach them.
    render(
      <FloatingCopilot title="Help" onClose={vi.fn()}>
        <p>help body</p>
      </FloatingCopilot>,
    );

    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(false);
    expect(screen.queryByTestId("copilot-fab")).not.toBeInTheDocument();
  });
});
