import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPathname = vi.fn<() => string>(() => "/teacher/classes");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

// Controllable researcher claim — drives the extra "Research" destination.
const { researcherRef } = vi.hoisted(() => ({ researcherRef: { current: false } }));
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => researcherRef.current }));

import { TeacherNav } from "@/components/teacher/ui/TeacherNav";

beforeEach(() => {
  researcherRef.current = false;
});

describe("TeacherNav", () => {
  it("renders the four core destinations (no Research) for a non-researcher", () => {
    mockPathname.mockReturnValue("/teacher/classes");
    render(<TeacherNav />);
    for (const label of ["Classes", "Activities", "Insights", "Settings"]) {
      expect(screen.getAllByRole("link", { name: new RegExp(label) })).toHaveLength(2);
    }
    expect(screen.queryByRole("link", { name: /Research/ })).not.toBeInTheDocument();
  });

  it("adds a Research destination for a researcher", () => {
    researcherRef.current = true;
    mockPathname.mockReturnValue("/teacher/classes");
    render(<TeacherNav />);
    // Present in both the rail and the bottom bar.
    expect(screen.getAllByRole("link", { name: /Research/ })).toHaveLength(2);
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

  it("treats reports as part of Insights", () => {
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
