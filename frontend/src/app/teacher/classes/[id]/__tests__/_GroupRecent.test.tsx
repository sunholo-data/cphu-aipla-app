import { act, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupRecent as GroupRecentData } from "@/lib/teacherApi";

const getGroupRecent = vi.fn();
vi.mock("@/lib/teacherApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/teacherApi")>()),
  getGroupRecent: (...a: unknown[]) => getGroupRecent(...a),
}));

import { GROUP_RECENT_REFRESH_MS, GroupRecent } from "@/app/teacher/classes/[id]/_GroupRecent";
import { LocaleProvider } from "@/i18n";

// 1.1.163 M1/M3 — the counted line under a group's row. Shapes match the prod
// window checked 2026-11-26 (green-beetle-49, 09:40–09:50).

const render = (ui: React.ReactElement, locale: "en" | "da" = "en") =>
  rtlRender(<LocaleProvider locale={locale}>{ui}</LocaleProvider>);

function window10(over: Partial<GroupRecentData> = {}): GroupRecentData {
  return {
    groupId: "green-beetle-49",
    minutes: 10,
    since: "2026-11-25T09:40:00Z",
    until: "2026-11-25T09:50:00Z",
    questions: 3,
    feedbackRequests: 5,
    tutorTurns: 8,
    tools: { calculate: 1 },
    sheets: [{ title: "Undervejs (Del 2-5)", wordsBefore: 42, wordsNow: 85 }],
    sims: [],
    documentsOpened: 3,
    tableEdits: 0,
    lastActivityAt: "2026-11-25T09:49:43Z",
    empty: false,
    synopsis: null,
    ...over,
  };
}

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  getGroupRecent.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("GroupRecent", () => {
  it("says what the group did, in reading order, with no AI", async () => {
    getGroupRecent.mockResolvedValue(window10());
    render(<GroupRecent classId="c1" code="green-beetle-49" />);
    expect(
      await screen.findByText(
        "wrote 43 words in “Undervejs (Del 2-5)” · 3 questions · asked for feedback 5 times · 8 tutor replies · opened 3 documents",
      ),
    ).toBeInTheDocument();
    expect(getGroupRecent).toHaveBeenCalledWith("c1", "green-beetle-49", 10);
    expect(screen.getByText(/no AI/)).toBeInTheDocument();
  });

  it("speaks Danish for a Danish teacher, and says when text was cut rather than written", async () => {
    getGroupRecent.mockResolvedValue(
      window10({
        sheets: [{ title: "Del 1", wordsBefore: 30, wordsNow: 25 }],
        sims: [{ id: "li-ion-batteri", name: "Lithium-ion-batteri", changes: 4 }],
        questions: 1,
        feedbackRequests: 0,
        tutorTurns: 0,
        documentsOpened: 0,
      }),
    );
    render(<GroupRecent classId="c1" code="g" />, "da");
    expect(
      await screen.findByText("rettede i «Del 1» (30 → 25 ord) · 4 ændringer i Lithium-ion-batteri · 1 spørgsmål"),
    ).toBeInTheDocument();
  });

  it("an empty window says so", async () => {
    getGroupRecent.mockResolvedValue(window10({ empty: true, questions: 0, sheets: [] }));
    render(<GroupRecent classId="c1" code="g" />);
    expect(await screen.findByText("Nothing in the last 10 minutes.")).toBeInTheDocument();
  });

  it("a failed read says it could not load — never 'nothing happened'", async () => {
    getGroupRecent.mockRejectedValue(new Error("503"));
    render(<GroupRecent classId="c1" code="g" />);
    expect(await screen.findByText(/Couldn't load the group's recent activity/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing in the last/)).not.toBeInTheDocument();
  });

  it("the window choice refetches and is remembered in this browser", async () => {
    getGroupRecent.mockImplementation(async (_c: string, _g: string, m: number) => window10({ minutes: m }));
    render(<GroupRecent classId="c1" code="g" />);
    await screen.findByText(/3 questions/);
    fireEvent.click(screen.getByRole("button", { name: "20 min" }));
    await waitFor(() => expect(getGroupRecent).toHaveBeenLastCalledWith("c1", "g", 20));
    expect(screen.getByRole("button", { name: "20 min" })).toHaveAttribute("aria-pressed", "true");
    expect(store.get("aipla.teacher.groupRecentMinutes")).toBe("20");
  });

  it("starts from the remembered window", async () => {
    store.set("aipla.teacher.groupRecentMinutes", "5");
    getGroupRecent.mockImplementation(async (_c: string, _g: string, m: number) => window10({ minutes: m }));
    render(<GroupRecent classId="c1" code="g" />);
    await waitFor(() => expect(getGroupRecent).toHaveBeenLastCalledWith("c1", "g", 5));
  });

  it("refreshes every two minutes while open", async () => {
    vi.useFakeTimers();
    getGroupRecent.mockResolvedValue(window10());
    render(<GroupRecent classId="c1" code="g" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const before = getGroupRecent.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_RECENT_REFRESH_MS);
    });
    expect(getGroupRecent.mock.calls.length).toBe(before + 1);
  });
});
