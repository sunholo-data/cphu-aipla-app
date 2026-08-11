import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/teacher/classes" }));
vi.mock("@/hooks/useTeacherAuth", () => ({
  useTeacherAuth: () => ({ user: { displayName: "Ms Hansen" }, loading: false }),
}));
vi.mock("@/lib/firebase", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/localMode", () => ({ isLocalMode: () => false }));
vi.mock("@/components/site/SiteFooter", () => ({ SiteFooter: () => <footer>footer</footer> }));

import { TeacherClientShell } from "@/app/teacher/_TeacherClientShell";
import * as researcherHook from "@/hooks/useIsResearcher";

beforeEach(() => {
  // Default: a plain teacher. Individual tests override for the researcher case.
  vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeacherClientShell", () => {
  it("renders the nav, page content, and footer for an authed teacher", () => {
    render(
      <TeacherClientShell>
        <p>page content</p>
      </TeacherClientShell>,
    );

    // children + footer still render after the nav-shell refactor
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByText("footer")).toBeInTheDocument();

    // primary nav destinations are present (rail + bottom bar)
    expect(screen.getAllByRole("link", { name: /Classes/ }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: /Insights/ }).length).toBeGreaterThanOrEqual(1);

    // account control preserved
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeInTheDocument();
  });

  it("hides the researcher badge for a plain teacher", () => {
    render(
      <TeacherClientShell>
        <p>page content</p>
      </TeacherClientShell>,
    );

    expect(screen.queryByText("Researcher")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /Researcher role active/ })).not.toBeInTheDocument();
  });

  it("shows the researcher badge when the caller holds the researcher claim", () => {
    vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(true);

    render(
      <TeacherClientShell>
        <p>page content</p>
      </TeacherClientShell>,
    );

    expect(screen.getByRole("status", { name: /Researcher role active/ })).toBeInTheDocument();
    expect(screen.getByText("Researcher")).toBeInTheDocument();
  });
});
