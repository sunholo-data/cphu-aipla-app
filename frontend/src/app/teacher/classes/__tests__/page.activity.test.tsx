/**
 * /teacher/classes — activity at a glance, sort, search + filter, and the
 * insights strip following the view (2026-09-11).
 *
 * The load-bearing assertions:
 *  - a class nobody has spoken in says so IN WORDS (a blank cell reads the
 *    same as "not permitted", and a researcher cannot tell them apart)
 *  - latest activity sorts first; silent classes sink
 *  - the insights strip is fetched for scope=all in research view (it used
 *    to fetch own-scope there, so a researcher with no classes of their own
 *    saw an empty strip under a full table) and the window is selectable
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TeacherClassesPage from "@/app/teacher/classes/page";
import * as teacherApi from "@/lib/teacherApi";
import * as insightsApi from "@/lib/insightsApi";
import * as researcherHook from "@/hooks/useIsResearcher";
import type { ClassPayload } from "@/lib/teacherApi";

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

let summarySpy: ReturnType<typeof vi.spyOn>;
let compareSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(teacherApi, "listClasses").mockResolvedValue(CLASSES);
  vi.spyOn(teacherApi, "fetchClassesActivity").mockResolvedValue(ACTIVITY);
  vi.spyOn(teacherApi, "listClassRecentSessions").mockResolvedValue([]);
  vi.spyOn(teacherApi, "listAccessibleSkills").mockResolvedValue([]);
  summarySpy = vi.spyOn(insightsApi, "fetchInsightsSummary").mockResolvedValue({
    since: "2026-05-26T00:00:00+00:00",
    until: "2026-06-02T00:00:00+00:00",
    classes: [],
  });
  compareSpy = vi.spyOn(insightsApi, "fetchInsightsCompare").mockResolvedValue({
    since: "2026-05-26T00:00:00+00:00",
    until: "2026-06-02T00:00:00+00:00",
    rows: [],
  });
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
    expect(cells[0]).toHaveTextContent("42 turns · 3 groups active");
    expect(cells[1]).toHaveTextContent("3 turns · 1 group active");
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
  });
});

describe("/teacher/classes — insights strip follows the view and the window", () => {
  it("fetches own-scope, 30d by default for a teacher; scope=all in research view; window is selectable", async () => {
    vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(true);
    render(<TeacherClassesPage />);
    await screen.findByRole("link", { name: "Busy class" });

    await userEvent.click(screen.getByRole("button", { name: /Show insights/ }));
    await waitFor(() => expect(summarySpy).toHaveBeenCalledWith("30d", undefined, "own"));
    expect(compareSpy).toHaveBeenCalledWith("30d", undefined, "own");

    await userEvent.click(screen.getByRole("button", { name: "Research view" }));
    await waitFor(() => expect(summarySpy).toHaveBeenCalledWith("30d", undefined, "all"));
    expect(compareSpy).toHaveBeenCalledWith("30d", undefined, "all");

    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Time window" }), "all");
    await waitFor(() => expect(summarySpy).toHaveBeenCalledWith("all", undefined, "all"));
    expect(screen.getByText("No engagement recorded in all time.")).toBeInTheDocument();
  });
});
