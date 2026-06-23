import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NoteEditor, type NoteEditorValue } from "../NoteEditor";

describe("NoteEditor", () => {
  it("offers an add affordance when empty", () => {
    const onChange = vi.fn();
    render(<NoteEditor value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));
    expect(onChange).toHaveBeenCalledWith({ title: "", body: "" });
  });

  it("edits the note body", () => {
    const onChange = vi.fn();
    render(<NoteEditor value={{ title: "", body: "" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/note text/i), { target: { value: "v = s / t" } });
    expect(onChange).toHaveBeenCalledWith({ title: "", body: "v = s / t" });
  });

  it("removes the note back to null", () => {
    const onChange = vi.fn();
    render(<NoteEditor value={{ title: "x", body: "y" } as NoteEditorValue} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove note/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
