import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
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
// `getIsProgrammeAdmin` is reached through TeacherNav's useIsProgrammeAdmin
// (1.1.76). Resolves false: this suite is about the shell, not the claim.
vi.mock("@/lib/firebase", () => ({
  signOut: vi.fn(),
  getIsProgrammeAdmin: () => Promise.resolve(false),
  subscribeToAuthState: () => () => {},
}));
vi.mock("@/lib/localMode", () => ({ isLocalMode: () => false }));
// The help co-pilot flag. Off by default here: the Help menu must still render.
const flags = vi.hoisted(() => ({ aiplaHelp: false }));
vi.mock("@/hooks/useTeacherFeature", () => ({
  useTeacherFeature: (name: string) => (name === "aiplaHelp" ? flags.aiplaHelp : false),
}));
vi.mock("@/components/site/SiteFooter", () => ({ SiteFooter: () => <footer>footer</footer> }));

import { TeacherClientShell } from "@/app/teacher/_TeacherClientShell";
import * as researcherHook from "@/hooks/useIsResearcher";

// 1.1.108 M2 — these tests assert the English copy; a teacher's default
// language is Danish, so render inside an English locale.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const r = rtlRender(wrap(ui), options);
  return { ...r, rerender: (next: ReactElement) => r.rerender(wrap(next)) };
}

beforeEach(() => {
  // Default: a plain teacher. Individual tests override for the researcher case.
  vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(false);
  flags.aiplaHelp = false;
  authState.user = { displayName: "Ms Hansen", email: "hansen@ku.dk", photoURL: null };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeacherClientShell", () => {
  it("renders the nav, page content, and footer for an authed teacher", async () => {
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

    // account control preserved — behind the account menu since 1.1.125 M0
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menuitem", { name: /Sign out/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Settings/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Tutors/ })).toBeInTheDocument();
  });

  // UI sweep 2026-11-11 — Guides left the nav; the header Help menu carries
  // them on every page, including when the help co-pilot flag is off.
  it("reaches the guides from the header Help menu with the help flag off", async () => {
    render(
      <TeacherClientShell>
        <p>page content</p>
      </TeacherClientShell>,
    );
    expect(screen.queryByRole("link", { name: /^Guides$/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Help/ }));
    expect(screen.getByRole("menuitem", { name: /Guides/ })).toHaveAttribute("href", "/guides");
    expect(screen.queryByRole("menuitem", { name: /Ask AIPLA Help/ })).not.toBeInTheDocument();
  });

  it("offers the help co-pilot in the same menu when the flag is on", async () => {
    flags.aiplaHelp = true;
    render(
      <TeacherClientShell>
        <p>page content</p>
      </TeacherClientShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Help/ }));
    expect(screen.getByRole("menuitem", { name: /Guides/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Ask AIPLA Help/ })).toBeInTheDocument();
  });

  it("puts a skip link to the main content first", () => {
    render(
      <TeacherClientShell>
        <p>page content</p>
      </TeacherClientShell>,
    );
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip).toHaveAttribute("href", "#teacher-main");
    expect(document.querySelectorAll("a, button")[0]).toBe(skip);
    expect(screen.getByRole("main")).toHaveAttribute("id", "teacher-main");
  });

  it("shows no researcher role for a plain teacher", async () => {
    render(
      <TeacherClientShell>
        <p>page content</p>
      </TeacherClientShell>,
    );

    expect(screen.queryByTestId("account-role-marker")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.queryByText(/Role:/)).not.toBeInTheDocument();
  });

  // The header "Forsker" pill became a role line in the account menu, with a
  // marker on its trigger so the role stays visible on every page.
  it("shows the researcher role in the account menu, not as a header pill", async () => {
    vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(true);

    render(
      <TeacherClientShell>
        <p>page content</p>
      </TeacherClientShell>,
    );

    expect(screen.queryByRole("status", { name: /Researcher role active/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("account-role-marker")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByTestId("account-role")).toHaveTextContent("Role: researcher");
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
