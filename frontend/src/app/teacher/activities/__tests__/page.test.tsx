import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TeacherActivitiesPage from "@/app/teacher/activities/page";

describe("TeacherActivitiesPage", () => {
  it("renders the page title and an empty state with a New activity link", () => {
    render(<TeacherActivitiesPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Activities" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();

    const newLinks = screen.getAllByRole("link", { name: /New activity/ });
    expect(newLinks.length).toBeGreaterThanOrEqual(1);
    expect(newLinks[0]).toHaveAttribute("href", "/teacher/activities/new");
  });
});
