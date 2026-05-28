import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LedPlanckResults } from "../LedPlanckResults";
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

describe("LedPlanckResults", () => {
  it("shows the empty state when no LED has both U0 and lambda", () => {
    render(
      <LedPlanckResults snapshot={makeSnapshot()} reportEvent={vi.fn()} />,
    );
    expect(
      screen.getByText(/for at beregne/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Gem et resultat for at se gennemsnit/i),
    ).toBeInTheDocument();
  });

  it("does not offer a save row when only U0 (no lambda) is present", () => {
    render(
      <LedPlanckResults
        snapshot={makeSnapshot({ fits: { red: 1.99 } })}
        reportEvent={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Gem/i })).toBeNull();
  });

  it("computes h and emits a measurement when the student saves", () => {
    const reportEvent = vi.fn();
    render(
      <LedPlanckResults
        snapshot={makeSnapshot({
          fits: { red: 1.99 },
          spectra: { red: 625 },
        })}
        reportEvent={reportEvent}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    expect(reportEvent).toHaveBeenCalledTimes(1);
    const arg = reportEvent.mock.calls[0][0];
    expect(arg.kind).toBe("led-planck.measurement");
    expect(arg.data.led).toBe("red");
    expect(arg.data.u0).toBe(1.99);
    expect(arg.data.lambda).toBe(625);
    // h = U0.e.lambda/c  ~= 6.647e-34
    expect(arg.data.h_computed / 1e-34).toBeCloseTo(6.647, 2);
  });

  it("labels the button 'Opdatér' once a result for that LED is saved", () => {
    render(
      <LedPlanckResults
        snapshot={makeSnapshot({
          fits: { red: 1.99 },
          spectra: { red: 625 },
          measurements: [
            { led: "red", u0: 1.99, lambda: 625, h_computed: 6.647e-34 },
          ],
        })}
        reportEvent={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Opdatér" }),
    ).toBeInTheDocument();
  });

  it("renders the saved table + average vs accepted", () => {
    render(
      <LedPlanckResults
        snapshot={makeSnapshot({
          measurements: [
            { led: "red", u0: 1.99, lambda: 625, h_computed: 6.6e-34 },
            { led: "blue", u0: 2.64, lambda: 470, h_computed: 6.62e-34 },
          ],
        })}
        reportEvent={vi.fn()}
      />,
    );
    expect(screen.getByText("rød")).toBeInTheDocument();
    expect(screen.getByText("blå")).toBeInTheDocument();
    expect(screen.getByText("6.600")).toBeInTheDocument();
    expect(screen.getByText("6.620")).toBeInTheDocument();
    expect(screen.getByText(/Gennemsnit/i)).toBeInTheDocument();
  });
});
