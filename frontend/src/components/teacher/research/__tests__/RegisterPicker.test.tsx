import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RegisterPicker } from "@/components/teacher/research/RegisterPicker";

describe("the approach's voice (1.1.111)", () => {
  it("defaults to not set, because most approaches should say nothing about voice", () => {
    render(<RegisterPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Not set" })).toHaveAttribute("aria-pressed", "true");
  });

  it("warns when a terse voice is put on an approach built from questions", async () => {
    // The production bug this control exists to stop: mikkel ran `concise`
    // ("do not end with a follow-up question") against ESRU, 23 of whose 42
    // moves are ask-moves. Nobody saw it, because the two were chosen on
    // different screens by different people.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<RegisterPicker value={null} askMoveCount={23} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Concise" }));
    expect(onChange).toHaveBeenCalledWith("concise");

    rerender(<RegisterPicker value="concise" askMoveCount={23} onChange={onChange} />);
    expect(screen.getByRole("status")).toHaveTextContent(/not to end with a question/i);
  });

  it("warns when a hint-first voice is put on an elicit-first approach", () => {
    // frida (warm) against Accountable Talk, 25 of 35 ask-moves; sofie the same
    // against POE. `warm` does not soften those approaches, it inverts them.
    render(<RegisterPicker value="warm" askMoveCount={25} onChange={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/hint before asking/i);
  });

  it("does not warn about a voice that contradicts nothing", () => {
    render(<RegisterPicker value="rigorous" askMoveCount={23} onChange={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not warn when the approach has no ask-moves to contradict", () => {
    // A custom approach is free text with no parsed moves, so there is nothing
    // to be inconsistent with and a warning would be noise.
    render(<RegisterPicker value="concise" onChange={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("can be cleared back to no voice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RegisterPicker value="warm" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Not set" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
