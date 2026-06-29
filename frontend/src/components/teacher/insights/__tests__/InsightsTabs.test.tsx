import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockPathname = vi.fn<() => string>(() => "/teacher/insights");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

const mockIsResearcher = vi.fn<() => boolean>(() => false);
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => mockIsResearcher() }));

import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";

afterEach(() => mockIsResearcher.mockReturnValue(false));

describe("InsightsTabs", () => {
  it("renders nothing for a non-researcher (Overview is the only destination)", () => {
    mockIsResearcher.mockReturnValue(false);
    mockPathname.mockReturnValue("/teacher/insights");
    const { container } = render(<InsightsTabs />);
    expect(container).toBeEmptyDOMElement();
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

  it("renders Overview + Cost for a researcher, with Overview active on the insights route", () => {
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
