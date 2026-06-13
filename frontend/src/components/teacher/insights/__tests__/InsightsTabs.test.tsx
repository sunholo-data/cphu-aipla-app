import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockPathname = vi.fn<() => string>(() => "/teacher/insights");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

const mockIsResearcher = vi.fn<() => boolean>(() => false);
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => mockIsResearcher() }));

import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";

afterEach(() => mockIsResearcher.mockReturnValue(false));

describe("InsightsTabs", () => {
  it("renders Overview and Ask-the-data links", () => {
    mockPathname.mockReturnValue("/teacher/insights");
    render(<InsightsTabs />);
    expect(screen.getByRole("link", { name: /Overview/ })).toHaveAttribute(
      "href",
      "/teacher/insights",
    );
    expect(screen.getByRole("link", { name: /Ask the data/ })).toHaveAttribute(
      "href",
      "/teacher/analytics",
    );
  });

  it("marks Overview active on the insights route", () => {
    mockPathname.mockReturnValue("/teacher/insights");
    render(<InsightsTabs />);
    expect(screen.getByRole("link", { name: /Overview/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /Ask the data/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks Ask-the-data active on the analytics route", () => {
    mockPathname.mockReturnValue("/teacher/analytics");
    render(<InsightsTabs />);
    expect(screen.getByRole("link", { name: /Ask the data/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("hides the Cost tab for non-researchers", () => {
    mockIsResearcher.mockReturnValue(false);
    mockPathname.mockReturnValue("/teacher/insights");
    render(<InsightsTabs />);
    expect(screen.queryByRole("link", { name: /Cost/ })).not.toBeInTheDocument();
  });

  it("shows the Cost tab for researchers", () => {
    mockIsResearcher.mockReturnValue(true);
    mockPathname.mockReturnValue("/teacher/insights");
    render(<InsightsTabs />);
    expect(screen.getByRole("link", { name: /Cost/ })).toHaveAttribute(
      "href",
      "/teacher/insights/cost",
    );
  });
});
