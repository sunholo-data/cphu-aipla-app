import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceLayoutContext } from "../workspaceLayout";

// Stub the heavy children — this test covers the launch/takeover logic, not the
// sim iframe / element renderers / document fetches.
vi.mock("../GenericArtefactFrame", () => ({
  GenericArtefactFrame: () => <div data-testid="sim-frame" />,
}));
vi.mock("../elementRenderers", () => ({
  WorkspaceElements: (props: Record<string, unknown>) => (
    <div
      data-testid="workspace-elements"
      data-activity-id={String((props as { activityId?: unknown }).activityId ?? "")}
    />
  ),
}));
vi.mock("../DocumentsPanel", () => ({
  DocumentsPanel: (props: Record<string, unknown>) => (
    <div
      data-testid="documents"
      data-activity-id={String((props as { activityId?: unknown }).activityId ?? "")}
    />
  ),
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
      conceptMap={[]}
      table={[]}
      chart={[]}
      calculator={[]}
      note={[]}
      writing={[]}
      solution={[]}
      document={[]}
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

// 1.1.120 — progress endpoints are ACTIVITY-store-only. The elements surface
// must never receive a skill id as an activityId: that is the exact shape of
// the 2026-09-14 prod bug (GET /activities/{skillId}/table 404 loops, student
// PUT 403'd). DocumentsPanel keeps its skillId fallback deliberately — the
// document/curriculum subsystem tolerates one (dual-read), progress does not.
describe("StudentWorkspace — activityId plumbing (1.1.120)", () => {
  it("gives the elements NO activityId when none is passed — no doomed progress calls", () => {
    renderWS();
    expect(screen.getByTestId("workspace-elements").getAttribute("data-activity-id")).toBe("");
    // The documents panel keeps the skillId fallback on purpose.
    expect(screen.getByTestId("documents").getAttribute("data-activity-id")).toBe("s");
  });

  it("passes a real act- activityId through to both surfaces", () => {
    renderWS({ activityId: "act-777" });
    expect(screen.getByTestId("workspace-elements").getAttribute("data-activity-id")).toBe("act-777");
    expect(screen.getByTestId("documents").getAttribute("data-activity-id")).toBe("act-777");
  });
});

describe("StudentWorkspace — sim focus mode (1.1.140 M1)", () => {
  // A FRESH in-memory localStorage per test: on CI's Node 22 jsdom's storage
  // persists across a file's tests, and a remembered focus would leak.
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });

  // Stands in for the chat page + WorkspaceShell: holds the split ratio and
  // exposes it, so a test can read whether the chat column would be hidden.
  function Harness({ initial = 0.5, children }: { initial?: number; children: ReactNode }) {
    const [ratio, setRatio] = useState(initial);
    return (
      <WorkspaceLayoutContext.Provider value={{ ratio, setRatio }}>
        <output data-testid="ratio">{ratio}</output>
        <button type="button" onClick={() => setRatio(0.5)}>
          reveal-chat
        </button>
        {children}
      </WorkspaceLayoutContext.Provider>
    );
  }

  const WS_PROPS = {
    skillId: "s",
    activityId: "act-1",
    sandboxOrigin: "https://sandbox.example",
    artefact: ARTEFACT,
    checklist: [],
    conceptMap: [],
    table: [],
    chart: [],
    calculator: [],
    note: [],
    writing: [],
    solution: [],
    document: [],
    materials: [],
  };
  const ratio = () => screen.getByTestId("ratio").textContent;
  const toggle = () => document.querySelector("[data-sim-focus-toggle]") as HTMLElement;
  const openSim = () => fireEvent.click(screen.getByRole("button", { name: /åbn boldkast/i }));

  it("offers no focus toggle where there is no chat beside the sim (builder preview)", () => {
    renderWS();
    openSim();
    expect(document.querySelector("[data-sim-focus-toggle]")).toBeNull();
  });

  it("hides the chat column and gives it back, remembering the choice per activity", () => {
    render(
      <Harness>
        <StudentWorkspace {...WS_PROPS} />
      </Harness>,
    );
    openSim();
    // The label names the ACTION the button will take (no aria-pressed).
    expect(toggle()).toHaveAccessibleName("Fokus på simuleringen"); // chat shown
    fireEvent.click(toggle());
    expect(ratio()).toBe("1");
    expect(toggle()).toHaveAccessibleName("Vis chatten igen");
    expect(store.get("aipla.simFocus:act-1")).toBe("1");

    fireEvent.click(toggle());
    expect(ratio()).toBe("0.5");
    expect(store.get("aipla.simFocus:act-1")).toBe("0");
  });

  it("re-applies a remembered focus on open, and hands the chat back on close", () => {
    store.set("aipla.simFocus:act-1", "1");
    render(
      <Harness initial={0.6}>
        <StudentWorkspace {...WS_PROPS} />
      </Harness>,
    );
    expect(ratio()).toBe("0.6"); // nothing happens until the sim is open
    openSim();
    expect(ratio()).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: /luk boldkast/i }));
    expect(ratio()).toBe("0.6");
    expect(store.get("aipla.simFocus:act-1")).toBe("1"); // closing is not opting out
  });

  it("does not re-hide the chat after the student brought it back another way", () => {
    store.set("aipla.simFocus:act-1", "1");
    render(
      <Harness>
        <StudentWorkspace {...WS_PROPS} />
      </Harness>,
    );
    openSim();
    expect(ratio()).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "reveal-chat" })); // the "Show chat" tab
    expect(store.get("aipla.simFocus:act-1")).toBe("0");
  });

  it("keeps a separate preference per activity", () => {
    store.set("aipla.simFocus:other-activity", "1");
    render(
      <Harness>
        <StudentWorkspace {...WS_PROPS} />
      </Harness>,
    );
    openSim();
    expect(ratio()).toBe("0.5");
  });

  it("compacts the header below ~900px: tighter padding, icon-only close", () => {
    renderWS();
    openSim();
    const header = document.querySelector("[data-sim-frame-header]")!;
    expect(header.className).toMatch(/max-\[899px\]:py-1/);
    const closeText = screen.getByText("Luk");
    expect(closeText.className).toMatch(/max-\[899px\]:hidden/);
    // ...and the button keeps its accessible name when the text is hidden.
    expect(screen.getByRole("button", { name: /luk boldkast/i })).toBeInTheDocument();
  });
});
