import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "@/components/teacher/ui/EmptyState";

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(<EmptyState title="Nothing here" description="Add one to start" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Add one to start")).toBeInTheDocument();
  });

  it("exposes a status role for assistive tech", () => {
    render(<EmptyState title="T" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders an action when provided", () => {
    render(<EmptyState title="T" action={<button>Create</button>} />);
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("renders an icon when provided", () => {
    const { container } = render(<EmptyState title="T" icon={Inbox} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
