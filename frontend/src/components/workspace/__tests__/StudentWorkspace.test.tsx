import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Stub the heavy children — this test covers the launch/takeover logic, not the
// sim iframe / element renderers / document fetches.
vi.mock("../GenericArtefactFrame", () => ({
  GenericArtefactFrame: () => <div data-testid="sim-frame" />,
}));
vi.mock("../elementRenderers", () => ({
  WorkspaceElements: () => <div data-testid="workspace-elements" />,
}));
vi.mock("../DocumentsPanel", () => ({
  DocumentsPanel: () => <div data-testid="documents" />,
}));

import { StudentWorkspace } from "../StudentWorkspace";

const ARTEFACT = { id: "boldkast", displayName: "Boldkast", artefactPath: "boldkast/v1" };

function renderWS(props: Record<string, unknown> = {}) {
  return render(
    <StudentWorkspace
      skillId="s"
      sandboxOrigin="https://sandbox.example"
      artefact={ARTEFACT}
      checklist={[]}
      table={[]}
      chart={[]}
      calculator={[]}
      note={[]}
      materials={[]}
      {...props}
    />,
  );
}

describe("StudentWorkspace — sim launch/takeover", () => {
  it("shows a launch card (not the sim) by default, alongside the element tools", () => {
    renderWS();
    expect(screen.getByRole("button", { name: /åbn boldkast/i })).toBeInTheDocument();
    expect(screen.queryByTestId("sim-frame")).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-elements")).toBeInTheDocument();
  });

  it("opens the sim as a takeover (hiding the tools) and closes back to them", () => {
    renderWS();
    fireEvent.click(screen.getByRole("button", { name: /åbn boldkast/i }));
    expect(screen.getByTestId("sim-frame")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-elements")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /luk boldkast/i }));
    expect(screen.queryByTestId("sim-frame")).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-elements")).toBeInTheDocument();
  });

  it("renders no launcher when the environment has no sandbox origin", () => {
    renderWS({ sandboxOrigin: "" });
    expect(screen.queryByRole("button", { name: /åbn boldkast/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-elements")).toBeInTheDocument();
  });
});
