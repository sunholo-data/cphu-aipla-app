import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkbenchCalculator, type CalculatorElementDef } from "../WorkbenchCalculator";

const CALC: CalculatorElementDef = {
  id: "calc1",
  title: "Fart",
  formula: "s / t",
  inputs: [
    { id: "s", label: "Strækning", unit: "m" },
    { id: "t", label: "Tid", unit: "s" },
  ],
};

describe("WorkbenchCalculator", () => {
  it("renders the inputs and the formula", () => {
    render(<WorkbenchCalculator skillId="s" calculators={[CALC]} />);
    expect(screen.getByLabelText("Strækning")).toBeInTheDocument();
    expect(screen.getByLabelText("Tid")).toBeInTheDocument();
    expect(screen.getByText("s / t =")).toBeInTheDocument();
  });

  it("shows — until every input is filled, then computes the result", () => {
    render(<WorkbenchCalculator skillId="s" calculators={[CALC]} />);
    expect(screen.getByLabelText("Resultat")).toHaveTextContent("—");
    fireEvent.change(screen.getByLabelText("Strækning"), { target: { value: "10" } });
    expect(screen.getByLabelText("Resultat")).toHaveTextContent("—"); // t still empty
    fireEvent.change(screen.getByLabelText("Tid"), { target: { value: "2" } });
    expect(screen.getByLabelText("Resultat")).toHaveTextContent("5");
  });
});
