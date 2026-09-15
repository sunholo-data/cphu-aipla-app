import { describe, expect, it } from "vitest";
import { insertAtCaret } from "../insertAtCaret";

describe("insertAtCaret", () => {
  it("inserts in the middle and lands the caret after the glyph", () => {
    expect(insertAtCaret("v = 3 m/s", "Δ", 0, 0)).toEqual({ value: "Δv = 3 m/s", caret: 1 });
    expect(insertAtCaret("m/s", "²", 3, 3)).toEqual({ value: "m/s²", caret: 4 });
    expect(insertAtCaret("a = v/t", "Δ", 4, 4)).toEqual({ value: "a = Δv/t", caret: 5 });
  });

  it("replaces a selection", () => {
    expect(insertAtCaret("delta v", "Δ", 0, 5)).toEqual({ value: "Δ v", caret: 1 });
  });

  it("appends when the field has never reported a selection", () => {
    expect(insertAtCaret("rho", "ρ", null, null)).toEqual({ value: "rhoρ", caret: 4 });
    expect(insertAtCaret("", "θ", undefined, undefined)).toEqual({ value: "θ", caret: 1 });
  });

  it("counts caret in UTF-16 units like the DOM does for multi-char glyphs", () => {
    // ⁻¹ is two code units; selectionStart after it must be 2.
    expect(insertAtCaret("s", "⁻¹", 1, 1)).toEqual({ value: "s⁻¹", caret: 3 });
  });
});
