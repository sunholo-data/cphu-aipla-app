import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

describe("TeacherPage", () => {
  it("renders the title as an h1 and the content", () => {
    render(
      <TeacherPage title="Classes">
        <p>content</p>
      </TeacherPage>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Classes" })).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("renders breadcrumb and actions when provided", () => {
    render(
      <TeacherPage title="T" breadcrumb={<span>Home / T</span>} actions={<button>New</button>}>
        <p>c</p>
      </TeacherPage>,
    );
    expect(screen.getByText("Home / T")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
});
