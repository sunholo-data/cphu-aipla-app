import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockPathname = vi.fn<() => string>(() => "/teacher/classes");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

import { TeacherNav } from "@/components/teacher/ui/TeacherNav";

describe("TeacherNav", () => {
  it("renders all four destinations in both rail and bottom bar", () => {
    mockPathname.mockReturnValue("/teacher/classes");
    render(<TeacherNav />);
    for (const label of ["Classes", "Activities", "Insights", "Settings"]) {
      expect(screen.getAllByRole("link", { name: new RegExp(label) })).toHaveLength(2);
    }
  });

  it("marks the active destination with aria-current and leaves others unset", () => {
    mockPathname.mockReturnValue("/teacher/insights");
    render(<TeacherNav />);
    for (const link of screen.getAllByRole("link", { name: /Insights/ })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
    for (const link of screen.getAllByRole("link", { name: /Classes/ })) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("treats analytics and reports as part of Insights", () => {
    mockPathname.mockReturnValue("/teacher/reports/groups/abc");
    render(<TeacherNav />);
    for (const link of screen.getAllByRole("link", { name: /Insights/ })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
  });

  it("marks Classes active on a nested class-detail route", () => {
    mockPathname.mockReturnValue("/teacher/classes/c-1");
    render(<TeacherNav />);
    for (const link of screen.getAllByRole("link", { name: /Classes/ })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
  });

  it("renders a desktop rail (hidden md:flex) and a mobile bottom bar (md:hidden)", () => {
    mockPathname.mockReturnValue("/teacher/classes");
    const { container } = render(<TeacherNav />);
    const navs = Array.from(container.querySelectorAll("nav"));
    expect(navs).toHaveLength(2);
    const classes = navs.map((n) => n.className);
    expect(classes.some((c) => c.includes("hidden") && c.includes("md:flex"))).toBe(true);
    expect(classes.some((c) => c.includes("md:hidden"))).toBe(true);
  });
});
