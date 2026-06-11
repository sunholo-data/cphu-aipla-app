import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PersonaHeader } from "@/components/chat/PersonaHeader";

describe("PersonaHeader", () => {
  it("renders nothing when there is no persona", () => {
    const { container } = render(<PersonaHeader persona={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the persona name, title, and avatar image", () => {
    render(
      <PersonaHeader
        persona={{
          id: "astrid",
          name: "Astrid",
          title: "Senior underviser",
          avatar: "/personas/astrid.webp",
        }}
      />,
    );
    expect(screen.getByText("Astrid")).toBeInTheDocument();
    expect(screen.getByText("Senior underviser")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Astrid" })).toBeInTheDocument();
  });

  it("falls back to an initials avatar when there is no image", () => {
    render(<PersonaHeader persona={{ id: "x", name: "Zoe", title: null, avatar: "" }} />);
    expect(screen.getByText("Zoe")).toBeInTheDocument();
    expect(screen.getByText("Z")).toBeInTheDocument();
  });
});
