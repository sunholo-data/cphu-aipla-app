import { describe, expect, it } from "vitest";

import { solutionDocToMarkdown, solutionWordCount, type PMNode } from "../solutionMarkdown";

const doc = (...content: PMNode[]): PMNode => ({ type: "doc", content });
const p = (...content: PMNode[]): PMNode => ({ type: "paragraph", content });
const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]): PMNode => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});

describe("solutionDocToMarkdown (1.1.45 M4)", () => {
  it("returns empty string for an empty/null doc", () => {
    expect(solutionDocToMarkdown(null)).toBe("");
    expect(solutionDocToMarkdown(doc())).toBe("");
  });

  it("serialises bold / italic / code marks", () => {
    const md = solutionDocToMarkdown(
      doc(p(t("normal "), t("bold", [{ type: "bold" }]), t(" "), t("em", [{ type: "italic" }]), t(" "), t("x", [{ type: "code" }]))),
    );
    expect(md).toBe("normal **bold** *em* `x`");
  });

  it("code mark suppresses other formatting (markdown semantics)", () => {
    const md = solutionDocToMarkdown(doc(p(t("v", [{ type: "code" }, { type: "bold" }]))));
    expect(md).toBe("`v`");
  });

  it("serialises a link", () => {
    const md = solutionDocToMarkdown(
      doc(p(t("see ", []), t("here", [{ type: "link", attrs: { href: "https://x.dk" } }]))),
    );
    expect(md).toBe("see [here](https://x.dk)");
  });

  it("carries underline through as plain text (no markdown form ChatMarkdown renders)", () => {
    expect(solutionDocToMarkdown(doc(p(t("under", [{ type: "underline" }]))))).toBe("under");
  });

  it("serialises inline + block math as $…$ / $$…$$", () => {
    const md = solutionDocToMarkdown(
      doc(
        p(t("Energy "), { type: "inlineMath", attrs: { latex: "E = mc^2" } }),
        { type: "blockMath", attrs: { latex: "h = v_0 t - \\tfrac12 g t^2" } },
      ),
    );
    expect(md).toBe("Energy $E = mc^2$\n\n$$h = v_0 t - \\tfrac12 g t^2$$");
  });

  it("serialises bullet and ordered lists", () => {
    const li = (text: string): PMNode => ({ type: "listItem", content: [p(t(text))] });
    const bullet = solutionDocToMarkdown(doc({ type: "bulletList", content: [li("a"), li("b")] }));
    expect(bullet).toBe("- a\n- b");
    const ordered = solutionDocToMarkdown(doc({ type: "orderedList", content: [li("first"), li("second")] }));
    expect(ordered).toBe("1. first\n2. second");
  });

  it("honours an ordered list's start attr", () => {
    const li = (text: string): PMNode => ({ type: "listItem", content: [p(t(text))] });
    const md = solutionDocToMarkdown(doc({ type: "orderedList", attrs: { start: 3 }, content: [li("c"), li("d")] }));
    expect(md).toBe("3. c\n4. d");
  });

  it("serialises an image and a heading", () => {
    expect(solutionDocToMarkdown(doc({ type: "image", attrs: { src: "blob:x", alt: "graf" } }))).toBe("![graf](blob:x)");
    expect(solutionDocToMarkdown(doc({ type: "heading", attrs: { level: 2 }, content: [t("Løsning")] }))).toBe("## Løsning");
  });

  it("joins blocks with a blank line and trims", () => {
    expect(solutionDocToMarkdown(doc(p(t("one")), p(t("two"))))).toBe("one\n\ntwo");
  });

  it("never throws on an unknown node — degrades to inline text", () => {
    expect(solutionDocToMarkdown(doc({ type: "mysteryBlock", content: [t("kept")] }))).toBe("kept");
  });
});

describe("solutionWordCount", () => {
  it("counts words across paragraphs + math latex", () => {
    const d = doc(p(t("the cat sat")), p({ type: "inlineMath", attrs: { latex: "x y" } }));
    expect(solutionWordCount(d)).toBe(5);
  });

  it("is 0 for an empty doc", () => {
    expect(solutionWordCount(doc(p()))).toBe(0);
  });
});
