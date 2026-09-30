import { fireEvent, render as rtlRender, screen, type RenderOptions } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NoteEditor, type NoteEditorValue } from "../NoteEditor";

import { LocaleProvider } from "@/i18n";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish, so render inside an English locale (the teacher chose EN).
function EnglishUI({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}
const render = (ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: EnglishUI, ...options });

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
