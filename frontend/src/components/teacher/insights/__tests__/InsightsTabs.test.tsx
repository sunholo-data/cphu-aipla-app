import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockPathname = vi.fn<() => string>(() => "/teacher/insights");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";

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
});
