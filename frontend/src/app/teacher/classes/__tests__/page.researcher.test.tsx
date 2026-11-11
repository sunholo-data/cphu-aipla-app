import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TeacherClassesPage from "@/app/teacher/classes/page";
import * as teacherApi from "@/lib/teacherApi";
import * as insightsApi from "@/lib/insightsApi";
import * as researcherHook from "@/hooks/useIsResearcher";
import type { ClassPayload } from "@/lib/teacherApi";
import { LocaleProvider } from "@/i18n";

// Scope and filter live in the URL (UI sweep 2026-11-11).
vi.mock("next/navigation", async () => (await import("@/test/nextNavigationMock")).navigationModule);
import { nav } from "@/test/nextNavigationMock";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish (the teacher's own DA | EN choice), so render inside an English locale.
function EnglishLocale({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}
const render = ((ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: EnglishLocale, ...options })) as typeof rtlRender;


function makeClass(overrides: Partial<ClassPayload> = {}): ClassPayload {
  return {
    classId: "c-1",
    ownerUid: "teacher-1",
    name: "Physik 9A",
    description: null,
    tagNamespace: "class:teacher-1:c-1",
    lessons: [],
    groupCodes: [],
    revoked: false,
    createdAt: "2026-05-26T00:00:00Z",
    updatedAt: "2026-05-26T00:00:00Z",
    revokedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  nav.reset("/teacher/classes");
  vi.spyOn(teacherApi, "listClassRecentSessions").mockResolvedValue([]);
  vi.spyOn(teacherApi, "listAccessibleSkills").mockResolvedValue([]);
  vi.spyOn(insightsApi, "fetchInsightsSummary").mockResolvedValue({
    since: "2026-05-26T00:00:00+00:00",
    until: "2026-06-02T00:00:00+00:00",
    classes: [],
  });
  vi.spyOn(insightsApi, "fetchInsightsCompare").mockResolvedValue({
    since: "2026-05-26T00:00:00+00:00",
    until: "2026-06-02T00:00:00+00:00",
    rows: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/teacher/classes — Research view (1.1.5)", () => {
  it("hides the Research view toggle for non-researchers", async () => {
    vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(false);
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([makeClass({ name: "Mine" })]);

    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Mine" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "All teachers' classes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Whose classes" })).not.toBeInTheDocument();
  });

  it("shows the toggle for researchers and switches to scope=all on click", async () => {
    vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(true);
    const listSpy = vi.spyOn(teacherApi, "listClasses").mockImplementation(async (scope) =>
      scope === "all"
        ? [
            makeClass({ classId: "mine", name: "Mine", ownerUid: "me" }),
            makeClass({ classId: "theirs", name: "Theirs", ownerUid: "R5Z5Y", ownerLabel: "Bob Jensen" }),
          ]
        : [makeClass({ classId: "mine", name: "Mine", ownerUid: "me" })],
    );

    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith("own");
    });
    // Other teacher's class not visible in My classes scope.
    expect(screen.queryByRole("link", { name: "Theirs" })).not.toBeInTheDocument();

    // One name on every page (UI sweep 2026-11-11): "Your classes | All teachers' classes".
    expect(screen.getByRole("button", { name: "Your classes" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "All teachers' classes" }));
    // …kept in the URL, so a researcher can link to it and Back keeps it.
    expect(nav.search.get("scope")).toBe("all");

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith("all");
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Theirs" })).toBeInTheDocument();
    });
    // Owner is surfaced in Research view — friendly label when resolved, raw
    // uid as the fallback.
    expect(screen.getAllByTestId("class-owner").length).toBeGreaterThan(0);
    expect(screen.getByText(/Owner: Bob Jensen/)).toBeInTheDocument();
    expect(screen.getByText(/Owner: me/)).toBeInTheDocument();
    // 1.1.124 M0 — each class carries its stage in the research view (both
    // fixtures have no codes → "No join code"), and the researcher's shortcut
    // to set a class up for a teacher replaces "New class" here.
    expect(screen.getAllByTestId("stage-chip").map((c) => c.getAttribute("data-stage"))).toEqual(["no_code", "no_code"]);
    // "Set up a class for a teacher…" sits in the header's ⋯ menu; "New class"
    // is for the researcher's own classes only.
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: /set up a class for a teacher/i })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "New class" })).not.toBeInTheDocument();
    // The Insights link follows the scope.
    expect(screen.getByRole("link", { name: /every teacher's classes, with spend/ })).toHaveAttribute(
      "href",
      "/teacher/insights/classes?scope=all",
    );
  });

  it("opens straight on all teachers' classes from a ?scope=all link", async () => {
    vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(true);
    nav.reset("/teacher/classes", "scope=all");
    const listSpy = vi.spyOn(teacherApi, "listClasses").mockResolvedValue([makeClass({ name: "Theirs" })]);
    render(<TeacherClassesPage />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith("all"));
    expect(screen.getByRole("button", { name: "All teachers' classes" })).toHaveAttribute("aria-pressed", "true");
  });

  it("ignores ?scope=all for a teacher without the claim", async () => {
    vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(false);
    nav.reset("/teacher/classes", "scope=all");
    const listSpy = vi.spyOn(teacherApi, "listClasses").mockResolvedValue([makeClass({ name: "Mine" })]);
    render(<TeacherClassesPage />);
    await screen.findByRole("link", { name: "Mine" });
    expect(listSpy).not.toHaveBeenCalledWith("all");
  });

  it("marks a class its teacher deleted, and does not count revoked codes as joinable (1.1.146)", async () => {
    vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(true);
    vi.spyOn(teacherApi, "listClasses").mockImplementation(async (scope) =>
      scope === "all"
        ? [
            makeClass({
              classId: "gone",
              name: "Deleted one",
              ownerUid: "ar",
              revoked: true,
              groupCodes: ["busy-garden-11"],
              revokedGroupCodes: ["busy-garden-11"],
            }),
          ]
        : [],
    );

    render(<TeacherClassesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "All teachers' classes" }));

    await waitFor(() => expect(screen.getByRole("link", { name: "Deleted one" })).toBeInTheDocument());
    expect(screen.getByTestId("class-deleted")).toHaveTextContent("Deleted by teacher");
    // Its only code is revoked: nothing to hand out, so the stage is "no code".
    expect(screen.getByTestId("stage-chip").getAttribute("data-stage")).toBe("no_code");
  });
});
