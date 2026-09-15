import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GuideBody } from "@/components/guides/GuideBody";

/**
 * The guides carry Quarto's `::: callout-note` fences verbatim — the move to
 * app pages (1.1.116) deliberately did not reword 6,600 words of prose. If this
 * splitter regresses, a guide does not error: it prints ":::" at a reader and
 * loses the panel, which is exactly the kind of drift nobody files a bug for.
 */
describe("GuideBody", () => {
  it("renders a callout fence as a titled panel, not as literal ':::'", () => {
    render(
      <GuideBody
        markdown={"::: callout-note\n## Where this fits\n\nDo this **once** per class.\n:::\n\n## Step 1\n\nOpen Classes."}
      />,
    );

    expect(screen.getByText("Where this fits")).toBeInTheDocument();
    expect(screen.getByText(/Do this/)).toBeInTheDocument();
    expect(screen.queryByText(/:::/)).not.toBeInTheDocument();
    // The prose either side of a callout still renders.
    expect(screen.getByRole("heading", { name: "Step 1", level: 2 })).toBeInTheDocument();
  });

  it("keeps a tip visually distinct from a note", () => {
    const { container } = render(
      <GuideBody markdown={"::: callout-tip\n## Faster\n\nAsk the co-pilot.\n:::"} />,
    );
    expect(container.querySelector("aside")?.className).toContain("emerald");
  });

  it("renders an image as a figure whose alt text is a visible caption", () => {
    const { container } = render(
      <GuideBody markdown={"![The class list shows each class.](/guides/assets/t1-02-class-list.png)"} />,
    );

    // A caption a reader can see — in a how-to, the alt text IS the caption.
    expect(screen.getByText("The class list shows each class.")).toBeInTheDocument();
    expect(container.querySelector("figure img")).toHaveAttribute(
      "src",
      "/guides/assets/t1-02-class-list.png",
    );
    // …and never nested inside a <p>, which the browser would re-parent.
    expect(container.querySelector("p figure")).toBeNull();
  });

  it("leaves ordinary paragraphs as paragraphs", () => {
    const { container } = render(<GuideBody markdown={"Open **Classes** and select New class."} />);
    expect(container.querySelector("p")?.textContent).toContain("Open");
  });
});
