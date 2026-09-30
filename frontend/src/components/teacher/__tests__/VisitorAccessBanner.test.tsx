import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import { beforeEach, describe, expect, it } from "vitest";

import { VisitorAccessBanner } from "@/components/teacher/VisitorAccessBanner";
import { __resetAccessTierForTests, setAccessTier } from "@/lib/accessTier";

// 1.1.108 M2 — these tests assert the English copy; a teacher's default
// language is Danish, so render inside an English locale.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const r = rtlRender(wrap(ui), options);
  return { ...r, rerender: (next: ReactElement) => r.rerender(wrap(next)) };
}

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
    expect(screen.getByText(/recorded demonstration/i)).toBeInTheDocument();
    // One language at a time now (1.1.108 M2) — no Danish under English.
    expect(screen.getByRole("status").textContent ?? "").not.toMatch(/[æøåÆØÅ]/);
  });

  it("speaks Danish by default — the teacher's language until they switch (1.1.108 M2)", () => {
    rtlRender(<VisitorAccessBanner />);
    expect(screen.getByText(/optaget demonstration/i)).toBeInTheDocument();
    expect(screen.queryByText(/recorded demonstration/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Bliv en del af programmet" })).toBeInTheDocument();
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
