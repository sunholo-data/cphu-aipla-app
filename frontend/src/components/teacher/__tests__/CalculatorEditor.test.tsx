import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CalculatorEditor, type CalculatorEditorValue } from "../CalculatorEditor";

const VALUE: CalculatorEditorValue = {
  title: "Fart",
  formula: "s / t",
  inputs: [
    { key: 1, id: "s", label: "Strækning", unit: "m" },
    { key: 2, id: "t", label: "Tid", unit: "s" },
  ],
};

describe("CalculatorEditor", () => {
  it("offers an add affordance when empty and seeds one variable", () => {
    const onChange = vi.fn();
    render(<CalculatorEditor value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add calculator/i }));
    const next = onChange.mock.calls[0][0] as CalculatorEditorValue;
    expect(next.inputs).toHaveLength(1);
  });

  it("confirms a valid formula over its declared variables", () => {
    render(<CalculatorEditor value={VALUE} onChange={vi.fn()} />);
    expect(screen.getByText(/formula looks good/i)).toBeInTheDocument();
  });

  it("flags a formula that references an undeclared variable", () => {
    render(<CalculatorEditor value={{ ...VALUE, formula: "s / q" }} onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/formula problem/i);
  });

  it("adds and removes variables", () => {
    const onChange = vi.fn();
    render(<CalculatorEditor value={VALUE} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add variable/i }));
    expect((onChange.mock.calls[0][0] as CalculatorEditorValue).inputs).toHaveLength(3);
    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /remove variable 1/i }));
    expect((onChange.mock.calls[0][0] as CalculatorEditorValue).inputs).toHaveLength(1);
  });

  it("removes the calculator back to null", () => {
    const onChange = vi.fn();
    render(<CalculatorEditor value={VALUE} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove calculator/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
