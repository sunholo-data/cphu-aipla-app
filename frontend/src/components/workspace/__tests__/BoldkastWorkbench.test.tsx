import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  ),
}));
vi.mock("@/hooks/useHumanToolEvents", () => ({
  useHumanToolEvents: () => ({ events: [], dispatch: vi.fn(), clear: vi.fn() }),
}));

import { BoldkastWorkbench } from "../BoldkastWorkbench";
import type { BoldkastSnapshot } from "@/hooks/useBoldkastSnapshot";

function makeSnapshot(
  overrides: Partial<BoldkastSnapshot> = {},
): BoldkastSnapshot {
  return {
    lastEvent: "",
    v0: null,
    theta: null,
    g: null,
    revealedMarkers: [],
    ...overrides,
  };
}

const SUBPARTS = [
  { id: "a", label: "Delopgave a" },
  { id: "b", label: "Delopgave b" },
];

function renderWorkbench(snapshot: BoldkastSnapshot) {
  return render(
    <BoldkastWorkbench
      snapshot={snapshot}
      onOpenSim={() => {}}
      skillId="problem-set-hints"
      subParts={SUBPARTS}
      sessionId={null}
    />,
  );
}

describe("BoldkastWorkbench", () => {
  it("renders the journey card and the launch button", () => {
    renderWorkbench(makeSnapshot());
    expect(screen.getByText(/Sådan virker det/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Åbn Boldkast simulator/i)).toBeInTheDocument();
  });

  it("shows the config empty state before any throw", () => {
    renderWorkbench(makeSnapshot());
    expect(
      screen.getByText(/Åbn simulatoren og kast en bold/i),
    ).toBeInTheDocument();
  });

  it("shows the results empty state before any throw", () => {
    renderWorkbench(makeSnapshot());
    expect(
      screen.getByText(/Forudsig først — afslør så/i),
    ).toBeInTheDocument();
  });

  it("mirrors the current configuration after a throw", () => {
    renderWorkbench(makeSnapshot({ v0: 20, theta: 45, g: 9.8 }));
    expect(screen.getByText("20 m/s")).toBeInTheDocument();
    expect(screen.getByText("45°")).toBeInTheDocument();
    expect(screen.getByText("9.8 m/s²")).toBeInTheDocument();
  });

  it("reveal-gates results: computed value only for revealed markers", () => {
    renderWorkbench(
      makeSnapshot({ v0: 20, theta: 45, g: 9.8, revealedMarkers: ["range"] }),
    );
    // range = v0^2 sin(2*45)/g = 400/9.8 = 40.8 m (revealed)
    expect(screen.getByText("40.8 m")).toBeInTheDocument();
    // tof + ymax not revealed -> hidden prompt (2 of them)
    expect(
      screen.getAllByText(/Skjult — tryk Vis i simulatoren/i).length,
    ).toBe(2);
  });

  it("renders the progress checklist", () => {
    renderWorkbench(makeSnapshot());
    expect(screen.getByText("Fremgang")).toBeInTheDocument();
    expect(screen.getByText("Delopgave a")).toBeInTheDocument();
  });
});
