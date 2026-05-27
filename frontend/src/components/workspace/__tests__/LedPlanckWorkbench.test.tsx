import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LedPlanckWorkbench } from "../LedPlanckWorkbench";
import type { LedPlanckSnapshot } from "../LedPlanckLabFrame";

const EMPTY: LedPlanckSnapshot | null = null;

const MID_LAB: LedPlanckSnapshot = {
  lastEvent: "led-planck.measurement",
  currentStep: 3,
  currentStepName: "part2",
  measurements: [
    { led: "red", u0: 1.99, lambda: 625, h_computed: 6.6e-34 },
    { led: "blue", u0: 2.64, lambda: 470, h_computed: 6.62e-34 },
  ],
  componentsPlaced: ["led", "voltmeter", "resistor"],
  lastPolarityError: null,
  voltage: 3.2,
};

describe("LedPlanckWorkbench", () => {
  it("renders the lesson framing card with the h = U0eλ/c formula", () => {
    render(<LedPlanckWorkbench snapshot={EMPTY} />);
    expect(screen.getByText(/Om dette eksperiment/i)).toBeInTheDocument();
    expect(screen.getByText(/h = U₀ · e · λ \/ c/)).toBeInTheDocument();
  });

  it("highlights step 1 (Kredsløb) when snapshot is null", () => {
    render(<LedPlanckWorkbench snapshot={EMPTY} />);
    const nuTags = screen.getAllByText(/nu/i);
    expect(nuTags.length).toBeGreaterThan(0);
    // Step 1 should be the active one — find its row.
    const kredsRow = screen.getByText(/1\. Kredsløb/i).closest("li");
    expect(kredsRow).toBeTruthy();
    expect(kredsRow!.textContent).toMatch(/nu/i);
  });

  it("advances the step indicator from snapshot.currentStepName", () => {
    render(<LedPlanckWorkbench snapshot={MID_LAB} />);
    const spektRow = screen.getByText(/3\. Spektroskopi/i).closest("li");
    expect(spektRow).toBeTruthy();
    expect(spektRow!.textContent).toMatch(/nu/i);
  });

  it("renders a measurements table with Danish LED names + h values", () => {
    render(<LedPlanckWorkbench snapshot={MID_LAB} />);
    // Headers
    expect(screen.getByText(/U₀ \(V\)/)).toBeInTheDocument();
    // Danish row labels
    expect(screen.getByText("rød")).toBeInTheDocument();
    expect(screen.getByText("blå")).toBeInTheDocument();
    // h column values rendered as ×10⁻³⁴
    expect(screen.getByText("6.600")).toBeInTheDocument(); // red: 6.6e-34
    expect(screen.getByText("6.620")).toBeInTheDocument(); // blue: 6.62e-34
  });

  it("shows empty state for measurements when snapshot is null", () => {
    render(<LedPlanckWorkbench snapshot={EMPTY} />);
    expect(
      screen.getByText(/Ingen målinger endnu/i),
    ).toBeInTheDocument();
  });

  it("renders placed components in Danish, comma-separated", () => {
    render(<LedPlanckWorkbench snapshot={MID_LAB} />);
    expect(
      screen.getByText(/LED, voltmeter, modstand/i),
    ).toBeInTheDocument();
  });

  it("shows empty state for components when snapshot is null", () => {
    render(<LedPlanckWorkbench snapshot={EMPTY} />);
    expect(
      screen.getByText(/Ingen komponenter placeret endnu/i),
    ).toBeInTheDocument();
  });
});
