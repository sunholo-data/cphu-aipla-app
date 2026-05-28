import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LedPlanckMeasureTable } from "../LedPlanckMeasureTable";

describe("LedPlanckMeasureTable", () => {
  it("shows the designed empty state when there are no readings", () => {
    render(<LedPlanckMeasureTable readings={{}} />);
    expect(screen.getByText(/Ingen målinger endnu/i)).toBeInTheDocument();
  });

  it("treats an LED with a zero-length array as empty", () => {
    render(<LedPlanckMeasureTable readings={{ red: [] }} />);
    expect(screen.getByText(/Ingen målinger endnu/i)).toBeInTheDocument();
  });

  it("renders a per-LED table with point count and I in mA", () => {
    render(
      <LedPlanckMeasureTable
        readings={{
          red: [
            { I: 0.01, U: 1.85, Vs: 3.2 },
            { I: 0.02, U: 1.95, Vs: 3.6 },
          ],
        }}
      />,
    );
    expect(screen.getByText(/rød/i)).toBeInTheDocument();
    expect(screen.getByText(/2 punkter/i)).toBeInTheDocument();
    // 0.01 A -> 10.00 mA
    expect(screen.getByText("10.00")).toBeInTheDocument();
    expect(screen.getByText("20.00")).toBeInTheDocument();
  });
});
