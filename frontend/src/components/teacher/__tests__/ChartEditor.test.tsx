import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChartEditor } from "../ChartEditor";

describe("ChartEditor", () => {
  it("offers an add affordance when empty", () => {
    const onChange = vi.fn();
    render(<ChartEditor value={null} onChange={onChange} hasTable />);
    fireEvent.click(screen.getByRole("button", { name: /add chart/i }));
    expect(onChange).toHaveBeenCalledWith({ title: "", chartKind: "scatter" });
  });

  it("changes the chart type", () => {
    const onChange = vi.fn();
    render(<ChartEditor value={{ title: "", chartKind: "scatter" }} onChange={onChange} hasTable />);
    fireEvent.change(screen.getByLabelText(/chart type/i), { target: { value: "line" } });
    expect(onChange).toHaveBeenCalledWith({ title: "", chartKind: "line" });
  });

  it("warns when there is no suitable data table", () => {
    render(<ChartEditor value={{ title: "", chartKind: "scatter" }} onChange={vi.fn()} hasTable={false} />);
    expect(screen.getByText(/this chart plots a data table/i)).toBeInTheDocument();
  });

  it("removes the chart back to null", () => {
    const onChange = vi.fn();
    render(<ChartEditor value={{ title: "x", chartKind: "bar" }} onChange={onChange} hasTable />);
    fireEvent.click(screen.getByRole("button", { name: /remove chart/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
