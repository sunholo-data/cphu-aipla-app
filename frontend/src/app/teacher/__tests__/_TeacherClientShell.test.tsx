import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/teacher/classes" }));
// Mutable so a test can change the signed-in account. `vi.hoisted` because
// `vi.mock` factories are hoisted above ordinary module scope.
const authState = vi.hoisted(() => ({
  user: {} as { displayName?: string | null; email?: string | null; photoURL?: string | null },
}));
vi.mock("@/hooks/useTeacherAuth", () => ({
  useTeacherAuth: () => ({ user: authState.user, loading: false }),
}));
vi.mock("@/lib/firebase", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/localMode", () => ({ isLocalMode: () => false }));
vi.mock("@/components/site/SiteFooter", () => ({ SiteFooter: () => <footer>footer</footer> }));

import { TeacherClientShell } from "@/app/teacher/_TeacherClientShell";
import * as researcherHook from "@/hooks/useIsResearcher";

beforeEach(() => {
  // Default: a plain teacher. Individual tests override for the researcher case.
  vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(false);
  authState.user = { displayName: "Ms Hansen", email: "hansen@ku.dk", photoURL: null };
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

  // Two accounts for one person share a display name and its initials, so an
  // initials-only chip cannot tell them apart. On 2026-08-18 a prod
  // investigation ran for an hour in the wrong account for exactly that reason.
  describe("the signed-in account is identifiable", () => {
    it("shows the email, not just the initials", () => {
      render(
        <TeacherClientShell>
          <p>page content</p>
        </TeacherClientShell>,
      );

      expect(screen.getByText("hansen@ku.dk")).toBeInTheDocument();
      expect(screen.getByText("Signed in as hansen@ku.dk")).toBeInTheDocument();
    });

    it("renders the Google account photo when the identity carries one", () => {
      authState.user = {
        displayName: "Ms Hansen",
        email: "hansen@ku.dk",
        photoURL: "https://lh3.googleusercontent.com/a/abc123",
      };

      render(
        <TeacherClientShell>
          <p>page content</p>
        </TeacherClientShell>,
      );

      const img = document.querySelector('img[src="https://lh3.googleusercontent.com/a/abc123"]');
      expect(img).not.toBeNull();
      // Decorative: the email beside it is the accessible identity.
      expect(img?.getAttribute("alt")).toBe("");
      expect(screen.queryByText("MH")).not.toBeInTheDocument();
    });

    it("falls back to initials when there is no photo", () => {
      render(
        <TeacherClientShell>
          <p>page content</p>
        </TeacherClientShell>,
      );

      expect(screen.getByText("MH")).toBeInTheDocument();
    });

    it("falls back to the display name when the identity has no email", () => {
      authState.user = { displayName: "Ms Hansen", email: null, photoURL: null };

      render(
        <TeacherClientShell>
          <p>page content</p>
        </TeacherClientShell>,
      );

      expect(screen.getByText("Signed in as Ms Hansen")).toBeInTheDocument();
    });
  });
});
