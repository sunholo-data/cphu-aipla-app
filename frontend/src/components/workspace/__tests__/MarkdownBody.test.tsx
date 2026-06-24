import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MarkdownBody, MarkdownErrorBoundary } from "../MarkdownBody";

describe("MarkdownBody (1.1.45 M0 — rich parsed-doc rendering)", () => {
  it("renders markdown richly — headings + tables, not a raw <pre>", () => {
    const { container } = render(
      <MarkdownBody text={"# Energi\n\nNoter.\n\n| Størrelse | Værdi |\n|---|---|\n| v0 | 12 |"} />,
    );
    // A real table element (markdown table → <table>), not raw pipes in a <pre>.
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
    expect(screen.getByText("Energi")).toBeInTheDocument();
    // The pipe syntax must NOT survive as literal text.
    expect(screen.queryByText(/\| Størrelse \| Værdi \|/)).toBeNull();
  });

  it("renders a KaTeX formula (math support)", () => {
    const { container } = render(<MarkdownBody text={"Formlen er $E = mc^2$ her."} />);
    // rehype-katex emits .katex markup for inline math.
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("falls back to plain text when rendering throws (Axiom 5)", () => {
    function Boom(): never {
      throw new Error("render boom");
    }
    render(
      <MarkdownErrorBoundary
        fallback={<pre data-testid="fallback">raw text</pre>}
      >
        <Boom />
      </MarkdownErrorBoundary>,
    );
    expect(screen.getByTestId("fallback")).toHaveTextContent("raw text");
  });
});
