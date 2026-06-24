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

describe("StudentWorkspace — Documents tab (1.1.45 M1, activity-driven)", () => {
  const CHECKLIST = [{ id: "c1", label: "Step 1" }];
  const MATERIALS = [{ docId: "d1", origin: "Haka Fysik", studentVisible: true }];

  it("shows NO tabs when only the element tools have content", () => {
    renderWS({ sandboxOrigin: "", checklist: CHECKLIST, materials: [] });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-elements")).toBeInTheDocument();
  });

  it("shows NO tabs when only documents have content", () => {
    renderWS({ sandboxOrigin: "", checklist: [], materials: MATERIALS });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByTestId("documents")).toBeInTheDocument();
  });

  it("shows Arbejde/Dokumenter tabs with a count badge when BOTH surfaces have content", () => {
    renderWS({ sandboxOrigin: "", checklist: CHECKLIST, materials: MATERIALS });
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /arbejde/i })).toBeInTheDocument();
    const docsTab = screen.getByRole("tab", { name: /dokumenter/i });
    expect(docsTab).toHaveTextContent("1"); // 1 material → badge
    // Documents is wired to the Dokumenter tabpanel (Radix unmounts the inactive
    // panel; the default Arbejde panel shows the element tools).
    expect(screen.getByTestId("workspace-elements")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toContainElement(screen.getByTestId("workspace-elements"));
  });

  it("a launched sim takes over even when both surfaces have content (no tabs visible)", () => {
    renderWS({ checklist: CHECKLIST, materials: MATERIALS });
    fireEvent.click(screen.getByRole("button", { name: /åbn boldkast/i }));
    expect(screen.getByTestId("sim-frame")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});
