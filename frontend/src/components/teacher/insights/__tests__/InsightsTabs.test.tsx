import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockPathname = vi.fn<() => string>(() => "/teacher/insights");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

const mockIsResearcher = vi.fn<() => boolean>(() => false);
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => mockIsResearcher() }));

import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";

// 1.1.108 — teacher screens follow the person's language, Danish by default.
// These tests assert the English copy, so they render inside an English
// context; the Danish default has its own assertion in teacherResearchLocale.test.tsx.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const result = rtlRender(wrap(ui), options);
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}

afterEach(() => mockIsResearcher.mockReturnValue(false));

describe("InsightsTabs", () => {
  // UI sweep 2026-11-11 — "Overview" became "All classes" at its own path.
  it("gives a non-researcher Lessons first, then All classes", () => {
    mockIsResearcher.mockReturnValue(false);
    mockPathname.mockReturnValue("/teacher/insights/lessons");
    render(<InsightsTabs />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Lessons", "All classes"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/teacher/insights/lessons", "/teacher/insights/classes"]);
    expect(screen.queryByRole("link", { name: /Cost/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Conversations/ })).not.toBeInTheDocument();
  });

  it("marks only Lessons active on a lesson page", () => {
    mockIsResearcher.mockReturnValue(false);
    mockPathname.mockReturnValue("/teacher/insights/lessons/c1/act-1");
    render(<InsightsTabs />);
    expect(screen.getByRole("link", { name: /Lessons/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /All classes/ })).not.toHaveAttribute("aria-current");
  });

  it("never links to the retired /teacher/analytics chat surface", () => {
    mockIsResearcher.mockReturnValue(true);
    mockPathname.mockReturnValue("/teacher/insights/classes");
    render(<InsightsTabs />);
    expect(screen.queryByRole("link", { name: /Ask the data/ })).not.toBeInTheDocument();
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toBe("/teacher/analytics");
    }
  });

  it("renders Lessons + All classes + Conversations + Cost for a researcher, with All classes active on its route", () => {
    mockIsResearcher.mockReturnValue(true);
    mockPathname.mockReturnValue("/teacher/insights/classes");
    render(<InsightsTabs />);
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Lessons",
      "All classes",
      "Conversations",
      "Cost",
    ]);
    expect(screen.getByRole("link", { name: /All classes/ })).toHaveAttribute(
      "href",
      "/teacher/insights/classes",
    );
    expect(screen.getByRole("link", { name: /All classes/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /Cost/ })).toHaveAttribute(
      "href",
      "/teacher/insights/cost",
    );
    expect(screen.getByRole("link", { name: /Cost/ })).not.toHaveAttribute("aria-current");
    // 1.1.125 M2 — Conversations is an Insights tab, not a nav destination.
    expect(screen.getByRole("link", { name: /Conversations/ })).toHaveAttribute(
      "href",
      "/teacher/insights/conversations",
    );
  });

  it("marks the Cost tab active on the cost route", () => {
    mockIsResearcher.mockReturnValue(true);
    mockPathname.mockReturnValue("/teacher/insights/cost");
    render(<InsightsTabs />);
    expect(screen.getByRole("link", { name: /Cost/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
