import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { VisitorAccessBanner } from "@/components/teacher/VisitorAccessBanner";
import { __resetAccessTierForTests, setAccessTier } from "@/lib/accessTier";

/**
 * ACCESS-1 M4. The nudge has two jobs and both are asserted here: tell a
 * visitor what they are looking at, and stay entirely out of a pilot teacher's
 * way.
 */
describe("VisitorAccessBanner", () => {
  beforeEach(() => {
    __resetAccessTierForTests();
  });

  it("tells a visitor they are on a recorded demonstration", () => {
    render(<VisitorAccessBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/optaget demonstration/i)).toBeInTheDocument();
    expect(screen.getByText(/recorded demonstration/i)).toBeInTheDocument();
  });

  it("links to the access request in one click", () => {
    render(<VisitorAccessBanner />);
    const link = screen.getByRole("link", { name: /join the programme/i });
    expect(link).toHaveAttribute("href", "/teacher-access");
  });

  it("renders nothing at all for a pilot teacher", () => {
    setAccessTier("pilot");
    const { container } = render(<VisitorAccessBanner />);
    // Not merely hidden — absent, so the ordinary case pays no chrome.
    expect(container).toBeEmptyDOMElement();
  });

  it("is non-blocking: a status region, never an alert or a dialog", () => {
    // The whole premise is that an uninvited person can walk the product. A
    // role that traps focus or demands dismissal would contradict that.
    render(<VisitorAccessBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
