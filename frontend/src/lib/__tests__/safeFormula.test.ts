import { describe, expect, it } from "vitest";

import { evaluateFormula, splitFormula, validateFormula } from "@/lib/safeFormula";

describe("evaluateFormula — correctness", () => {
  it("evaluates arithmetic with precedence", () => {
    expect(evaluateFormula("2 + 3 * 4", {})).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4", {})).toBe(20);
    expect(evaluateFormula("2 ^ 3 ^ 2", {})).toBe(512); // right-associative
    expect(evaluateFormula("-3 + 5", {})).toBe(2);
    expect(evaluateFormula("10 / 4", {})).toBe(2.5);
  });

  it("binds named variables", () => {
    expect(evaluateFormula("s / t", { s: 10, t: 2 })).toBe(5);
    expect(evaluateFormula("0.5 * m * v ^ 2", { m: 4, v: 3 })).toBe(18);
  });

  it("supports the whitelisted functions", () => {
    expect(evaluateFormula("sqrt(16)", {})).toBe(4);
    expect(evaluateFormula("abs(0 - 7)", {})).toBe(7);
  });

  it("returns null on non-finite results (divide by zero)", () => {
    expect(evaluateFormula("1 / 0", {})).toBeNull();
  });

  it("returns null on unknown variables and functions", () => {
    expect(evaluateFormula("x + 1", {})).toBeNull();
    expect(evaluateFormula("foo(2)", {})).toBeNull();
  });

  it("accepts the equation form by stripping a leading `name =`", () => {
    expect(evaluateFormula("E = m * c^2", { m: 2, c: 3 })).toBe(18);
    expect(evaluateFormula("v = s / t", { s: 10, t: 2 })).toBe(5);
  });

  it("tolerates Unicode math operators (× ⋅ ÷ −)", () => {
    expect(evaluateFormula("m × c", { m: 2, c: 3 })).toBe(6);
    expect(evaluateFormula("m ⋅ c", { m: 2, c: 3 })).toBe(6);
    expect(evaluateFormula("10 ÷ 4", {})).toBe(2.5);
    expect(evaluateFormula("5 − 3", {})).toBe(2);
  });
});

describe("splitFormula", () => {
  it("strips a single `identifier =` prefix and returns the label", () => {
    expect(splitFormula("E = m * c^2")).toEqual({ label: "E", expr: " m * c^2" });
  });
  it("leaves a plain expression untouched", () => {
    expect(splitFormula("s / t")).toEqual({ label: null, expr: "s / t" });
  });
  it("does not split when the left side isn't a bare identifier or there are several =", () => {
    expect(splitFormula("2x = 3")).toEqual({ label: null, expr: "2x = 3" });
    expect(splitFormula("E = m = c")).toEqual({ label: null, expr: "E = m = c" });
  });
});

describe("evaluateFormula — security (cannot execute code)", () => {
  const ATTACKS = [
    "constructor",
    "this",
    "process",
    "globalThis",
    "window",
    "__proto__",
    "a.b",
    "x['y']",
    "1; 2",
    "(()=>1)()",
    "require('fs')",
    "1 + alert(1)",
    "process.exit(1)",
  ];
  it.each(ATTACKS)("refuses %s → null (never throws, never executes)", (src) => {
    expect(evaluateFormula(src, {})).toBeNull();
  });

  // The equation-form split must not become a code-execution hole: the
  // right-hand side still goes through the same whitelisted parser.
  it.each(["x = constructor", "a = process.exit(1)", "y = (()=>1)()"])(
    "refuses the equation form %s → null",
    (src) => {
      expect(evaluateFormula(src, {})).toBeNull();
    },
  );
});

describe("validateFormula", () => {
  it("accepts a formula over its declared variables", () => {
    expect(validateFormula("s / t", ["s", "t"]).ok).toBe(true);
  });
  it("rejects an empty formula", () => {
    expect(validateFormula("  ", ["s"]).ok).toBe(false);
  });
  it("rejects an undeclared variable", () => {
    expect(validateFormula("s / q", ["s", "t"]).ok).toBe(false);
  });
  it("rejects malformed syntax", () => {
    expect(validateFormula("s /", ["s"]).ok).toBe(false);
  });
  it("accepts the equation form over declared variables", () => {
    expect(validateFormula("E = m * c^2", ["m", "c"]).ok).toBe(true);
  });
  it("suggests * between variables for implicit multiplication", () => {
    const r = validateFormula("mc^2", ["m", "c"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/m \* c/);
  });
  it("guides toward the right-hand side when several = are present", () => {
    const r = validateFormula("E = m = c", ["m", "c"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/right-hand side/i);
  });
});
