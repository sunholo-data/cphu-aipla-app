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
  it("gives a non-researcher Lessons first, then Overview (1.1.139 M2)", () => {
    mockIsResearcher.mockReturnValue(false);
    mockPathname.mockReturnValue("/teacher/insights");
    render(<InsightsTabs />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/teacher/insights/lessons", "/teacher/insights"]);
    expect(screen.queryByRole("link", { name: /Cost/ })).not.toBeInTheDocument();
  });

  it("marks only Lessons active on a lesson page — Overview is not a prefix match", () => {
    mockIsResearcher.mockReturnValue(false);
    mockPathname.mockReturnValue("/teacher/insights/lessons/c1/act-1");
    render(<InsightsTabs />);
    expect(screen.getByRole("link", { name: /Lessons/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Overview/ })).not.toHaveAttribute("aria-current");
  });

  it("never links to the retired /teacher/analytics chat surface", () => {
    mockIsResearcher.mockReturnValue(true);
    mockPathname.mockReturnValue("/teacher/insights");
    render(<InsightsTabs />);
    expect(screen.queryByRole("link", { name: /Ask the data/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Overview/ })?.getAttribute("href"),
    ).not.toBe("/teacher/analytics");
  });

  it("renders Overview + Conversations + Cost for a researcher, with Overview active on the insights route", () => {
    mockIsResearcher.mockReturnValue(true);
    mockPathname.mockReturnValue("/teacher/insights");
    render(<InsightsTabs />);
    expect(screen.getByRole("link", { name: /Overview/ })).toHaveAttribute(
      "href",
      "/teacher/insights",
    );
    expect(screen.getByRole("link", { name: /Overview/ })).toHaveAttribute(
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
