import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceDivider } from "../WorkspaceDivider";

function renderWithRow(ratio: number, onChange: (n: number) => void) {
  // Render a fake row that the divider's closest('[data-workspace-row]')
  // will find. jsdom gives the row 0px width by default, so override
  // getBoundingClientRect on the row to a predictable shape.
  const utils = render(
    <div data-workspace-row data-testid="row">
      <WorkspaceDivider ratio={ratio} onChange={onChange} />
    </div>,
  );
  const row = screen.getByTestId("row");
  Object.defineProperty(row, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({ left: 0, right: 1000, top: 0, bottom: 800, width: 1000, height: 800 }) as DOMRect,
  });
  return utils;
}

describe("WorkspaceDivider", () => {
  it("renders with separator role + ARIA attrs", () => {
    renderWithRow(0.5, () => {});
    const sep = screen.getByRole("separator");
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
    expect(sep).toHaveAttribute("aria-valuenow", "50");
    expect(sep).toHaveAttribute("aria-valuemin", "30");
    expect(sep).toHaveAttribute("aria-valuemax", "100");
  });

  it("ArrowLeft decreases the ratio by 0.05", () => {
    const onChange = vi.fn();
    renderWithRow(0.5, onChange);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(0.45);
  });

  it("ArrowRight increases the ratio by 0.05", () => {
    const onChange = vi.fn();
    renderWithRow(0.55, onChange);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(0.6);
  });

  it("Home jumps to RATIO_MIN (0.30)", () => {
    const onChange = vi.fn();
    renderWithRow(0.65, onChange);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "Home" });
    expect(onChange).toHaveBeenCalledWith(0.3);
  });

  it("End jumps to RATIO_MAX (1.00)", () => {
    const onChange = vi.fn();
    renderWithRow(0.5, onChange);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "End" });
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("Enter snaps to 0.50", () => {
    const onChange = vi.fn();
    renderWithRow(0.72, onChange);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(0.5);
  });

  it("snaps to 0.50 when keyboard would land inside the snap zone", () => {
    // Start at 0.475: ArrowRight steps to 0.525 — within ±2.5% of 0.50.
    // Expect snap to 0.50 (not 0.525).
    const onChange = vi.fn();
    renderWithRow(0.475, onChange);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(0.5);
  });

  it("clamps ArrowLeft at RATIO_MIN (0.30)", () => {
    const onChange = vi.fn();
    renderWithRow(0.32, onChange);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    // 0.32 - 0.05 = 0.27, clamped to 0.30, then within snap zone of 0.30 -> 0.30
    expect(onChange).toHaveBeenCalledWith(0.3);
  });

  it("ignores unrelated keys (no onChange call)", () => {
    const onChange = vi.fn();
    renderWithRow(0.5, onChange);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "a" });
    fireEvent.keyDown(screen.getByRole("separator"), { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pointerdown + document pointermove computes ratio from cursor X", () => {
    const onChange = vi.fn();
    renderWithRow(0.5, onChange);
    const sep = screen.getByRole("separator");
    fireEvent.pointerDown(sep, { clientX: 500 });
    // Simulate a pointermove at clientX=700 → workspace width = 300 →
    // ratio = 300/1000 = 0.30. After snap (within snap zone), still 0.30.
    fireEvent.pointerMove(document, { clientX: 700 });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last).toBeCloseTo(0.3, 2);
  });
});
