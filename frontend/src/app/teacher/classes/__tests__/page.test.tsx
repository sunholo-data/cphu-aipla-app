import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TeacherClassesPage from "@/app/teacher/classes/page";
import { MOCK_CLASSES, MOCK_RECENT_SESSIONS } from "@/app/teacher/_mock-data";

describe("/teacher/classes — dashboard", () => {
  it("renders the class cards from mock data", () => {
    render(<TeacherClassesPage />);
    for (const cls of MOCK_CLASSES) {
      expect(screen.getByRole("heading", { name: cls.name })).toBeInTheDocument();
    }
  });

  it("links each class card to its detail page", () => {
    render(<TeacherClassesPage />);
    for (const cls of MOCK_CLASSES) {
      const link = screen
        .getAllByRole("link", { name: /manage/i })
        .find(
          (el) => el.getAttribute("href") === `/teacher/classes/${cls.id}`,
        );
      expect(link).toBeDefined();
    }
  });

  it("shows the recent-activity rows from mock data with view links", () => {
    render(<TeacherClassesPage />);
    for (const row of MOCK_RECENT_SESSIONS) {
      expect(screen.getByText(row.groupCode)).toBeInTheDocument();
      const viewLink = screen
        .getAllByRole("link", { name: /view/i })
        .find(
          (el) =>
            el.getAttribute("href") ===
            `/teacher/reports/groups/${row.groupCode}`,
        );
      expect(viewLink).toBeDefined();
    }
  });

  it("links to the analytics chat surface", () => {
    render(<TeacherClassesPage />);
    const link = screen.getByRole("link", {
      name: /chat with all session data/i,
    });
    expect(link).toHaveAttribute("href", "/teacher/analytics");
  });
});
