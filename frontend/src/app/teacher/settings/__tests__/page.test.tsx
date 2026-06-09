import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TeacherSettingsPage from "@/app/teacher/settings/page";

describe("TeacherSettingsPage", () => {
  it("renders the settings title and a placeholder empty state", () => {
    render(<TeacherSettingsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
