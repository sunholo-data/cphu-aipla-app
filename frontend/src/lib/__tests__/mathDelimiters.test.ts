// 1.1.147 M0 — each repair in isolation. Prod examples are real 2026-10-05
// tutor turns (anonymised; no group or session ids).
import { describe, expect, it } from "vitest";
import {
  holdOpenMath,
  normalizeMathDelimiters,
  prepareChatMaths,
  repairTextModeMaths,
  unwrapCodedMath,
} from "../mathDelimiters";

describe("unwrapCodedMath", () => {
  it("unwraps a code span whose whole content is inline maths", () => {
    expect(unwrapCodedMath("energien `$E_{\\text{el}}$` ud")).toBe("energien $E_{\\text{el}}$ ud");
  });

  it("unwraps two coded formulas on one line", () => {
    expect(unwrapCodedMath("ved at gange `$P$` med `$t$`.")).toBe("ved at gange $P$ med $t$.");
  });

  it("unwraps display maths and \\(…\\) / \\[…\\] spans", () => {
    expect(unwrapCodedMath("`$$E = P \\cdot t$$`")).toBe("$$E = P \\cdot t$$");
    expect(unwrapCodedMath("`\\(v = \\frac{s}{t}\\)`")).toBe("$v = \\frac{s}{t}$");
    expect(unwrapCodedMath("`\\[E = mc^2\\]`")).toBe("$$E = mc^2$$");
  });

  it("keeps {,} decimals and nested braces intact", () => {
    expect(unwrapCodedMath("`$350 \\text{ g}$` og `$0{,}35 \\text{ kg}$`")).toBe(
      "$350 \\text{ g}$ og $0{,}35 \\text{ kg}$",
    );
    expect(unwrapCodedMath("`$E_{\\text{pot}} = \\frac{1}{2}{m}_{\\text{b}}$`")).toBe(
      "$E_{\\text{pot}} = \\frac{1}{2}{m}_{\\text{b}}$",
    );
  });

  it("trims padding inside the span before matching", () => {
    expect(unwrapCodedMath("` $m$ `")).toBe("$m$");
  });

  it("leaves a span with text outside the delimiters alone", () => {
    for (const s of ["`price = $5`", "`npm run dev`", "`\\cdot`", "`$x$ and $y$`", "`see $x$`"]) {
      expect(unwrapCodedMath(s)).toBe(s);
    }
  });

  it("leaves the leading `\\cdot` span of the 10-05 turn as code and unwraps the rest", () => {
    const turn =
      "`\\cdot` er bare et gangetegn, så `$m \\cdot c \\cdot \\Delta T$` betyder det samme som `$m \\times c \\times \\Delta T$`.";
    expect(unwrapCodedMath(turn)).toBe(
      "`\\cdot` er bare et gangetegn, så $m \\cdot c \\cdot \\Delta T$ betyder det samme som $m \\times c \\times \\Delta T$.",
    );
  });

  it("never touches a fenced block, even one containing a coded formula", () => {
    const fenced = "Før\n\n```\nprint(`$x$`)\n```\n\nefter";
    expect(unwrapCodedMath(fenced)).toBe(fenced);
    const tilde = "~~~md\n`$x$`\n~~~";
    expect(unwrapCodedMath(tilde)).toBe(tilde);
  });

  it("leaves a multi-backtick span containing a backtick alone", () => {
    const s = "`` `$x$` ``";
    expect(unwrapCodedMath(s)).toBe(s);
  });
});

describe("normalizeMathDelimiters", () => {
  it("rewrites \\(…\\) to $…$", () => {
    expect(normalizeMathDelimiters("imagine you take \\(100\\text{ g}\\) of ice at \\(-20^\\circ\\text{C}\\)")).toBe(
      "imagine you take $100\\text{ g}$ of ice at $-20^\\circ\\text{C}$",
    );
  });

  it("rewrites a mid-sentence \\[…\\] to inline $$…$$", () => {
    expect(normalizeMathDelimiters("så \\[E = mc^2\\] gælder")).toBe("så $$E = mc^2$$ gælder");
  });

  it("pads a \\[…\\] on its own lines to a display block", () => {
    expect(normalizeMathDelimiters("Formlen:\n\\[\nE = P \\cdot t\n\\]\nSå")).toBe(
      "Formlen:\n\n\n$$\nE = P \\cdot t\n$$\n\n\nSå",
    );
  });

  it("skips code spans and fences", () => {
    const s = "`\\(x\\)` and\n```\n\\(y\\)\n```";
    expect(normalizeMathDelimiters(s)).toBe(s);
  });

  it("is the identity on $-delimited maths", () => {
    const s = "Farten er $v = \\frac{s}{t}$.";
    expect(normalizeMathDelimiters(s)).toBe(s);
  });
});

describe("repairTextModeMaths", () => {
  it("moves a degree sign out of \\text{} (prod: `\\text{ ^\\circ C}`)", () => {
    expect(repairTextModeMaths("ice at $-20\\text{ ^\\circ C}$ when")).toBe("ice at $-20^\\circ\\text{C}$ when");
  });

  it("handles the ^{\\circ} and \\degree variants", () => {
    expect(repairTextModeMaths("$20\\text{^{\\circ}C}$")).toBe("$20^\\circ\\text{C}$");
    expect(repairTextModeMaths("$20\\text{ \\degree C}$")).toBe("$20^\\circ\\text{C}$");
  });

  it("rewrites \\celsius (prod: `\\text{ \\celsius}`) and a bare \\celsius", () => {
    expect(repairTextModeMaths("op til $100{,}0\\text{ \\celsius}$ over")).toBe("op til $100{,}0^\\circ\\text{C}$ over");
    expect(repairTextModeMaths("$T = 80\\celsius$")).toBe("$T = 80^\\circ\\text{C}$");
  });

  it("is the identity on already-correct maths", () => {
    for (const s of [
      "$80^\\circ\\text{C}$",
      "$38 \\text{ \\%}$",
      "$67\\,\\%$",
      "$E_{\\text{pot}} = m \\cdot g \\cdot h$",
      "$100\\text{ g}$",
    ]) {
      expect(repairTextModeMaths(s)).toBe(s);
    }
  });

  it("only rewrites inside maths, never in code", () => {
    const s = "`\\text{ ^\\circ C}` and \\celsius in prose";
    expect(repairTextModeMaths(s)).toBe(s);
  });
});

describe("prepareChatMaths", () => {
  it("unwraps, normalises and repairs in one pass", () => {
    expect(prepareChatMaths("`\\(T = 100{,}0\\text{ \\celsius}\\)`")).toBe("$T = 100{,}0^\\circ\\text{C}$");
  });

  it("is byte-identical on code that is not maths", () => {
    for (const s of ["`price = $5`", "`npm run dev`", "```\n`$x$`\n```"]) {
      expect(prepareChatMaths(s)).toBe(s);
    }
  });
});

describe("holdOpenMath", () => {
  it("holds back an unclosed $ at the tail", () => {
    expect(holdOpenMath("Farten er $v = \\frac{s}{")).toBe("Farten er ");
  });

  it("holds back an unclosed $$", () => {
    expect(holdOpenMath("Se her: $$E = P")).toBe("Se her: ");
  });

  it("holds back an unclosed \\( and \\[", () => {
    expect(holdOpenMath("tag \\(100\\text{ g")).toBe("tag ");
    expect(holdOpenMath("tag \\[E = ")).toBe("tag ");
  });

  it("holds back an unclosed backtick", () => {
    expect(holdOpenMath("energien `$E_{\\text{el")).toBe("energien ");
    expect(holdOpenMath("energien `$E$")).toBe("energien ");
  });

  it("holds back a trailing lone backslash", () => {
    expect(holdOpenMath("tag \\")).toBe("tag ");
  });

  it("passes closed maths and code spans through", () => {
    const s = "Farten er $v = 2$ og `$E$` og \\(x\\) så";
    expect(holdOpenMath(s)).toBe(s);
  });

  it("passes a streaming fenced block through", () => {
    const s = "Kode:\n```python\nx = '$'";
    expect(holdOpenMath(s)).toBe(s);
  });
});
