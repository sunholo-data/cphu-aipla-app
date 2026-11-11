/**
 * /teacher/classes — activity at a glance, sort, search + filter, and the
 * insights strip following the view (2026-09-11).
 *
 * The load-bearing assertions:
 *  - a class nobody has spoken in says so IN WORDS (a blank cell reads the
 *    same as "not permitted", and a researcher cannot tell them apart)
 *  - latest activity sorts first; silent classes sink
 *  - (the insights strip moved to Insights → All classes in the UI sweep,
 *    2026-11-11; its scope + window tests live with that page)
 */

import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TeacherClassesPage from "@/app/teacher/classes/page";
import * as teacherApi from "@/lib/teacherApi";
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
    groupCodes: ["code-1"],
    revoked: false,
    createdAt: "2026-05-26T00:00:00Z",
    updatedAt: "2026-05-26T00:00:00Z",
    revokedAt: null,
    ...overrides,
  };
}

const CLASSES = [
  makeClass({ classId: "quiet", name: "Quiet class" }),
  makeClass({ classId: "old", name: "Old class" }),
  makeClass({ classId: "busy", name: "Busy class" }),
];

const ACTIVITY = {
  quiet: { sessions: 0, turns: 0, activeGroups: 0, lastMessageAt: null },
  old: { sessions: 1, turns: 3, activeGroups: 1, lastMessageAt: "2026-06-01T10:00:00+00:00" },
  busy: { sessions: 4, turns: 42, activeGroups: 3, lastMessageAt: new Date().toISOString() },
};

beforeEach(() => {
  nav.reset("/teacher/classes");
  vi.spyOn(teacherApi, "listClasses").mockResolvedValue(CLASSES);
  vi.spyOn(teacherApi, "fetchClassesActivity").mockResolvedValue(ACTIVITY);
  vi.spyOn(teacherApi, "listClassRecentSessions").mockResolvedValue([]);
  vi.spyOn(teacherApi, "listAccessibleSkills").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function rowNames(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1) // header
    .map((r) => within(r).getAllByRole("link")[0].textContent ?? "");
}

describe("/teacher/classes — activity column + sort", () => {
  it("shows turns, groups and recency, says 'no messages yet' in words, and sorts latest first", async () => {
    render(<TeacherClassesPage />);
    await screen.findByRole("link", { name: "Busy class" });
    await waitFor(() => expect(rowNames()).toEqual(["Busy class", "Old class", "Quiet class"]));

    const cells = screen.getAllByTestId("class-activity");
    // "turns" became "messages" (UI sweep 2026-11-11, copy item 7).
    expect(cells[0]).toHaveTextContent("42 messages · 3 groups active");
    expect(cells[1]).toHaveTextContent("3 messages · 1 group active");
    expect(cells[2]).toHaveTextContent("No messages yet");
  });

  it("search narrows by class name; the activity filter hides quiet / stale classes", async () => {
    render(<TeacherClassesPage />);
    await screen.findByRole("link", { name: "Busy class" });
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await userEvent.type(screen.getByRole("searchbox", { name: "Search classes" }), "old");
    await waitFor(() => expect(rowNames()).toEqual(["Old class"]));
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search classes" }));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Filter by activity" }), "quiet");
    await waitFor(() => expect(rowNames()).toEqual(["Quiet class"]));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Filter by activity" }), "active7d");
    await waitFor(() => expect(rowNames()).toEqual(["Busy class"]));
    // The filter is in the URL, so Back and a refresh keep it.
    expect(nav.search.get("filter")).toBe("active7d");
  });
});
