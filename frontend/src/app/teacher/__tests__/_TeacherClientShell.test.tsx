import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/teacher/classes" }));
vi.mock("@/hooks/useTeacherAuth", () => ({
  useTeacherAuth: () => ({ user: { displayName: "Ms Hansen" }, loading: false }),
}));
vi.mock("@/lib/firebase", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/localMode", () => ({ isLocalMode: () => false }));
vi.mock("@/components/AppFooter", () => ({ AppFooter: () => <footer>footer</footer> }));

import { TeacherClientShell } from "@/app/teacher/_TeacherClientShell";

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
});
