import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TeacherCard } from "@/components/teacher/ui/TeacherCard";

describe("TeacherCard", () => {
  it("renders children inside an article by default", () => {
    render(<TeacherCard>Hello</TeacherCard>);
    const card = screen.getByText("Hello");
    expect(card.closest("article")).not.toBeNull();
  });

  it("renders as a custom element via `as`", () => {
    render(<TeacherCard as="section">Body</TeacherCard>);
    expect(screen.getByText("Body").closest("section")).not.toBeNull();
  });

  it("merges a custom className with the base classes", () => {
    render(<TeacherCard className="custom-x">X</TeacherCard>);
    const card = screen.getByText("X");
    expect(card).toHaveClass("custom-x");
    expect(card).toHaveClass("border-border");
  });
});
