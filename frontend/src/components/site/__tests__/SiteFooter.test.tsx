import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "../SiteFooter";
import { ENGINEERING_CREDIT, KU_ECOSYSTEM } from "@/lib/ecosystem";

describe("SiteFooter", () => {
  it("links every KU ecosystem page", () => {
    render(<SiteFooter />);
    for (const link of KU_ECOSYSTEM) {
      expect(
        document.querySelector(`a[href="${link.href}"]`),
        `missing ecosystem link: ${link.label}`,
      ).not.toBeNull();
    }
  });

  it("credits the platform engineering with a link to sunholo.com", () => {
    render(<SiteFooter />);
    const credit = document.querySelector(
      `a[href="${ENGINEERING_CREDIT.href}"]`,
    );
    expect(credit).not.toBeNull();

    // The ANCHOR TEXT is the capability, not the company name — a link
    // reading "Sunholo" says nothing about where it goes. The name follows
    // as plain text, outside the <a>.
    expect(credit?.textContent).toContain("AI platform engineering");
    expect(credit?.textContent).not.toContain("Sunholo");
    expect(screen.getByText(/by Sunholo/)).toBeTruthy();
  });

  it("names the host institution and the funder", () => {
    render(<SiteFooter />);
    // Appears twice by design: as the department's ecosystem link and again
    // in the attribution line.
    expect(
      screen.getAllByText(/Institut for Naturfagenes Didaktik/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Novo Nordisk Foundation/)).toBeTruthy();
  });

  it("every outbound link is no-referrer — the join URL carries the group code", () => {
    render(<SiteFooter />);
    const external = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]'),
    );
    expect(external.length).toBeGreaterThan(0);

    for (const a of external) {
      expect(a.getAttribute("rel"), a.href).toBe("noopener noreferrer");
      // Without this, clicking out of /group?code=… hands the group code to
      // ind.ku.dk and sunholo.com in the Referer header.
      expect(a.getAttribute("referrerpolicy"), a.href).toBe("no-referrer");
      expect(a.getAttribute("target"), a.href).toBe("_blank");
    }
  });

  it("keeps the legal pages one click away", () => {
    render(<SiteFooter />);
    for (const href of ["/privacy", "/terms", "/credits", "/project"]) {
      expect(
        document.querySelector(`a[href="${href}"]`),
        `missing footer link: ${href}`,
      ).not.toBeNull();
    }
  });
});
