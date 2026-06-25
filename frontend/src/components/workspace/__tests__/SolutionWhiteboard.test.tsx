import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// perfect-freehand is a pure function; canvas itself isn't rendered in jsdom, so
// these tests cover the toolbar + the cancel/disable wiring (the drawing +
// export need a real browser — verified separately).
vi.mock("perfect-freehand", () => ({ getStroke: () => [] }));

import { SolutionWhiteboard } from "../SolutionWhiteboard";

const onAdd = vi.fn();
const onCancel = vi.fn();
afterEach(() => vi.clearAllMocks());

describe("SolutionWhiteboard (1.1.48 M2)", () => {
  it("renders the drawing tools + a canvas", () => {
    render(<SolutionWhiteboard onAdd={onAdd} onCancel={onCancel} />);
    for (const name of ["Pen", "Viskelæder", "Fortryd", "Ryd"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Tegneflade")).toBeInTheDocument();
  });

  it("disables 'Tilføj tegning' until there is ink", () => {
    render(<SolutionWhiteboard onAdd={onAdd} onCancel={onCancel} />);
    expect((screen.getByRole("button", { name: /tilføj tegning/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("cancels via Annuller", () => {
    render(<SolutionWhiteboard onAdd={onAdd} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /annuller/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("toggles the active tool between pen and eraser", () => {
    render(<SolutionWhiteboard onAdd={onAdd} onCancel={onCancel} />);
    const eraser = screen.getByRole("button", { name: "Viskelæder" });
    fireEvent.click(eraser);
    expect(eraser).toHaveAttribute("aria-pressed", "true");
    const pen = screen.getByRole("button", { name: "Pen" });
    fireEvent.click(pen);
    expect(pen).toHaveAttribute("aria-pressed", "true");
    expect(eraser).toHaveAttribute("aria-pressed", "false");
  });
});
