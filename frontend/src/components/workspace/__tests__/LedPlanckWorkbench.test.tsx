import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LedPlanckWorkbench } from "../LedPlanckWorkbench";
import type { LedPlanckSnapshot } from "@/hooks/useLedPlanckSnapshot";

function makeSnapshot(
  overrides: Partial<LedPlanckSnapshot> = {},
): LedPlanckSnapshot {
  return {
    lastEvent: "",
    currentStep: null,
    currentStepName: null,
    readings: {},
    fits: {},
    spectra: {},
    measurements: [],
    componentsPlaced: [],
    lastPolarityError: null,
    calibrated: false,
    voltage: null,
    ...overrides,
  };
}

const EMPTY = makeSnapshot();

// Only saved measurements set (no readings/fits/spectra) so the Danish
// LED names render exactly once — in the saved-results table — keeping
// getByText unambiguous. The MeasureTable + Results split surfaces have
// their own focused tests.
const MID_LAB = makeSnapshot({
  lastEvent: "led-planck.measurement",
  currentStep: 3,
  currentStepName: "part2",
  measurements: [
    { led: "red", u0: 1.99, lambda: 625, h_computed: 6.6e-34 },
    { led: "blue", u0: 2.64, lambda: 470, h_computed: 6.62e-34 },
  ],
  componentsPlaced: ["led", "voltmeter", "resistor"],
  voltage: 3.2,
});

describe("LedPlanckWorkbench", () => {
  const noop = vi.fn();

  it("renders the lesson framing card with the h = U0eλ/c formula", () => {
    render(<LedPlanckWorkbench snapshot={EMPTY} reportEvent={noop} />);
    expect(screen.getByText(/Om dette eksperiment/i)).toBeInTheDocument();
    // Formula appears in both the lesson card and the Results header.
    expect(screen.getAllByText(/h = U₀ · e · λ \/ c/).length).toBeGreaterThan(0);
  });

  it("highlights step 1 (Kredsløb) for a fresh snapshot", () => {
    render(<LedPlanckWorkbench snapshot={EMPTY} reportEvent={noop} />);
    const kredsRow = screen.getByText(/1\. Kredsløb/i).closest("li");
    expect(kredsRow).toBeTruthy();
    expect(kredsRow!.textContent).toMatch(/nu/i);
  });

  it("advances the step indicator from snapshot.currentStepName", () => {
    render(<LedPlanckWorkbench snapshot={MID_LAB} reportEvent={noop} />);
    const spektRow = screen.getByText(/3\. Spektroskopi/i).closest("li");
    expect(spektRow).toBeTruthy();
    expect(spektRow!.textContent).toMatch(/nu/i);
  });

  it("renders the saved-results table with Danish LED names + h values + average", () => {
    render(<LedPlanckWorkbench snapshot={MID_LAB} reportEvent={noop} />);
    expect(screen.getByText("rød")).toBeInTheDocument();
    expect(screen.getByText("blå")).toBeInTheDocument();
    expect(screen.getByText("6.600")).toBeInTheDocument(); // red: 6.6e-34
    expect(screen.getByText("6.620")).toBeInTheDocument(); // blue: 6.62e-34
    expect(screen.getByText(/Gennemsnit/i)).toBeInTheDocument();
  });

  it("shows the measure-table empty state for a fresh snapshot", () => {
    render(<LedPlanckWorkbench snapshot={EMPTY} reportEvent={noop} />);
    expect(screen.getByText(/Ingen målinger endnu/i)).toBeInTheDocument();
  });

  it("shows the results empty state when nothing is saved", () => {
    render(<LedPlanckWorkbench snapshot={EMPTY} reportEvent={noop} />);
    expect(
      screen.getByText(/Gem et resultat for at se gennemsnit/i),
    ).toBeInTheDocument();
  });

  it("renders placed components in Danish, comma-separated", () => {
    render(<LedPlanckWorkbench snapshot={MID_LAB} reportEvent={noop} />);
    expect(screen.getByText(/LED, voltmeter, modstand/i)).toBeInTheDocument();
  });

  it("shows empty state for components on a fresh snapshot", () => {
    render(<LedPlanckWorkbench snapshot={EMPTY} reportEvent={noop} />);
    expect(
      screen.getByText(/Ingen komponenter placeret endnu/i),
    ).toBeInTheDocument();
  });
});
