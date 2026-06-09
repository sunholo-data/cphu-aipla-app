import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdvancedDisclosure } from "@/components/teacher/ui/AdvancedDisclosure";

describe("AdvancedDisclosure", () => {
  it("renders the default 'Advanced' label and its children", () => {
    render(
      <AdvancedDisclosure>
        <p>secret</p>
      </AdvancedDisclosure>,
    );
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.getByText("secret")).toBeInTheDocument();
  });

  it("supports a custom label", () => {
    render(
      <AdvancedDisclosure label="More options">
        <p>x</p>
      </AdvancedDisclosure>,
    );
    expect(screen.getByText("More options")).toBeInTheDocument();
  });

  it("is closed by default and open when defaultOpen is set", () => {
    const { container, rerender } = render(
      <AdvancedDisclosure>
        <p>x</p>
      </AdvancedDisclosure>,
    );
    expect(container.querySelector("details")?.open).toBe(false);

    rerender(
      <AdvancedDisclosure defaultOpen>
        <p>x</p>
      </AdvancedDisclosure>,
    );
    expect(container.querySelector("details")?.open).toBe(true);
  });
});
