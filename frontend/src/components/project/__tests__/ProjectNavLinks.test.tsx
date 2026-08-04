import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectNavLinks } from "@/components/project/ProjectNavLinks";

vi.mock("next/navigation", () => ({
  usePathname: () => "/project/activities/boldkast",
}));

const pages = [
  { slug: "activities", title: "Activities and examples" },
  { slug: "activities/boldkast", title: "Boldkast: projectile motion" },
  { slug: "activities/led-planck", title: "LED Planck: virtual laboratory" },
];

describe("ProjectNavLinks", () => {
  it("includes nested project pages and marks only the exact page as current", () => {
    render(<ProjectNavLinks pages={pages} variant="desktop" />);

    expect(screen.getByRole("link", { name: "Boldkast: projectile motion" })).toHaveAttribute(
      "href",
      "/project/activities/boldkast",
    );
    expect(screen.getByRole("link", { name: "LED Planck: virtual laboratory" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Boldkast: projectile motion" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Activities and examples" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("identifies nested pages in the mobile navigation", () => {
    render(<ProjectNavLinks pages={pages} variant="mobile" />);

    expect(screen.getByRole("link", { name: "Boldkast: projectile motion" })).toHaveTextContent(
      "↳ Boldkast: projectile motion",
    );
  });
});
