import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// perfect-freehand is a pure function; canvas itself isn't rendered in jsdom, so
// these tests cover the toolbar + wiring (drawing + export need a real browser).
vi.mock("perfect-freehand", () => ({ getStroke: () => [] }));

import { SolutionWhiteboard } from "../SolutionWhiteboard";

const onAdd = vi.fn();
afterEach(() => vi.clearAllMocks());

describe("SolutionWhiteboard (1.1.48 M2)", () => {
  it("renders the drawing tools (incl. a text tool) + a canvas", () => {
    render(<SolutionWhiteboard onAdd={onAdd} />);
    for (const name of ["Pen", "Tekst", "Viskelæder", "Fortryd", "Ryd"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Tegneflade")).toBeInTheDocument();
  });

  it("disables 'Tilføj tegning' until there is something on the board", () => {
    render(<SolutionWhiteboard onAdd={onAdd} />);
    expect((screen.getByRole("button", { name: /tilføj tegning/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("selecting the text tool shows the placement hint", () => {
    render(<SolutionWhiteboard onAdd={onAdd} />);
    expect(screen.queryByText(/placere en tekst/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tekst" }));
    expect(screen.getByText(/placere en tekst/i)).toBeInTheDocument();
  });

  it("toggles the active tool between pen, text and eraser", () => {
    render(<SolutionWhiteboard onAdd={onAdd} />);
    const eraser = screen.getByRole("button", { name: "Viskelæder" });
    fireEvent.click(eraser);
    expect(eraser).toHaveAttribute("aria-pressed", "true");
    const text = screen.getByRole("button", { name: "Tekst" });
    fireEvent.click(text);
    expect(text).toHaveAttribute("aria-pressed", "true");
    expect(eraser).toHaveAttribute("aria-pressed", "false");
  });
});
