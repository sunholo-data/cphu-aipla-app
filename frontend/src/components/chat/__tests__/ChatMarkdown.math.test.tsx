// 1.1.147 M0 — tutor maths as the student sees it. Replays real 2026-10-05
// prod turns through ChatMarkdown: every formula typesets, no KaTeX error, and
// no LaTeX source survives in the text the student reads.
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMarkdown } from "../ChatMarkdown";
import { SOURCE_FRAGMENTS, TUTOR_MATH_SHAPES } from "@/test/fixtures/tutor-math-shapes";

vi.mock("@/components/chat/InlineCitation", () => ({
  InlineCitation: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/chat/media/PDFCard", () => ({ PDFCard: () => null }));

/** The text a student reads: everything except KaTeX's hidden MathML copy
 *  (which carries the TeX annotation) and the surviving code spans. */
function visibleText(container: HTMLElement, allowed: string[] = []): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".katex-mathml").forEach((n) => n.remove());
  clone.querySelectorAll("code").forEach((n) => {
    if (allowed.includes(n.textContent ?? "")) n.remove();
  });
  return clone.textContent ?? "";
}

describe("ChatMarkdown maths — real 2026-10-05 tutor turns", () => {
  it.each(TUTOR_MATH_SHAPES.map((s) => [s.name, s] as const))("%s", (_name, shape) => {
    const { container } = render(<ChatMarkdown content={shape.content} navigateToBlock={() => {}} />);
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(shape.minKatex);
    expect(container.querySelector(".katex-error")).toBeNull();
    const text = visibleText(container, shape.allowedSource);
    for (const fragment of SOURCE_FRAGMENTS) {
      expect(text, `literal ${fragment} in: ${text}`).not.toContain(fragment);
    }
  });

  it("keeps the `\\cdot` span that is not whole-maths as code", () => {
    const shape = TUTOR_MATH_SHAPES.find((s) => s.allowedSource?.includes("\\cdot"))!;
    const { container } = render(<ChatMarkdown content={shape.content} navigateToBlock={() => {}} />);
    const codes = Array.from(container.querySelectorAll("code")).map((c) => c.textContent);
    expect(codes).toEqual(["\\cdot"]);
  });
});

describe("ChatMarkdown maths — what must not change", () => {
  it("leaves non-maths code spans and fenced blocks as code", () => {
    const { container } = render(
      <ChatMarkdown
        content={"Kør `npm run dev` og `price = $5`.\n\n```\nprint(`$x$`)\n```"}
        navigateToBlock={() => {}}
      />,
    );
    const codes = Array.from(container.querySelectorAll("code")).map((c) => c.textContent);
    expect(codes).toContain("npm run dev");
    expect(codes).toContain("price = $5");
    expect(codes.some((c) => c?.includes("print(`$x$`)"))).toBe(true);
    expect(container.querySelector(".katex")).toBeNull();
  });

  it("does not typeset unwrapped LaTeX", () => {
    const { container } = render(
      <ChatMarkdown content={"E = \\frac{1}{2} m v^2"} navigateToBlock={() => {}} />,
    );
    expect(container.querySelector(".katex")).toBeNull();
  });

  it("renders a formula KaTeX cannot parse as its source in the body colour, not red", () => {
    const { container } = render(
      <ChatMarkdown content={"Se $x^$ her"} navigateToBlock={() => {}} />,
    );
    const err = container.querySelector(".katex-error") as HTMLElement | null;
    expect(err).not.toBeNull();
    expect(err!.style.color).toBe("inherit");
  });
});
