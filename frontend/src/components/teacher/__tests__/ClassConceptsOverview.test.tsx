// 1.1.139 M2 (first slice) — the class's concepts at the top of the class page.
//
// The property this file defends: at the TOP of the page, an empty or broken
// concept graph is worse than none. So the section exists only when the rollup
// holds concepts; otherwise nothing, or one muted line.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: (...args: unknown[]) => mockFetch(...args),
}));

import {
  ClassConceptsOverview,
  classConceptsOpenKey,
} from "@/components/teacher/ClassConceptsOverview";
import { LocaleProvider } from "@/i18n";

const ROLLUP = {
  classId: "cls-1",
  groups: ["grp-a"],
  classGroups: ["grp-a", "grp-b"],
  edges: [],
  concepts: [
    {
      concept: "Vektorer",
      key: "vektorer",
      byGroup: { "grp-a": "demonstrated" },
      counts: { demonstrated: 1, partial: 0, not_yet: 0 },
      activityIds: ["act-1"],
      flags: [],
    },
  ],
};

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function renderEn(classId = "cls-1") {
  return render(
    <LocaleProvider locale="en">
      <ClassConceptsOverview classId={classId} />
    </LocaleProvider>,
  );
}

let store: Map<string, string>;

beforeEach(() => {
  mockFetch.mockReset();
  // A fresh in-memory localStorage per test: on CI's Node 22 jsdom's storage
  // persists across a file's tests, so a remembered "closed" would leak.
  store = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

describe("ClassConceptsOverview", () => {
  it("shows 'Concepts across the class', open, when the rollup has concepts", async () => {
    mockFetch.mockResolvedValue(ok(ROLLUP));
    renderEn();

    await screen.findByTestId("class-concept-graph");
    expect(screen.getByRole("heading", { name: "Concepts across the class" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Concepts across the class/, expanded: true })).toBeInTheDocument();
    expect(document.getElementById("class-concepts")).not.toBeNull();
  });

  it("renders one muted line and no card when the class has no concepts", async () => {
    mockFetch.mockResolvedValue(ok({ ...ROLLUP, concepts: [] }));
    renderEn();

    const hint = await screen.findByTestId("class-concepts-hint");
    expect(hint).toHaveTextContent(/concept map/i);
    expect(screen.queryByRole("heading", { name: "Concepts across the class" })).toBeNull();
    // The graph's own "nothing ticked yet" paragraph must not leak out either.
    expect(screen.getByTestId("class-concept-empty")).not.toBeVisible();
  });

  it("renders nothing at all when the rollup cannot be read", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
    renderEn();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).not.toBeVisible());
    expect(screen.queryByTestId("class-concepts-hint")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Concepts across the class" })).toBeNull();
  });

  it("remembers collapsed per class", async () => {
    mockFetch.mockResolvedValue(ok(ROLLUP));
    const { unmount } = renderEn("cls-1");
    fireEvent.click(await screen.findByRole("button", { name: /Concepts across the class/, expanded: true }));
    expect(store.get(classConceptsOpenKey("cls-1"))).toBe("0");
    unmount();

    renderEn("cls-1");
    expect(
      await screen.findByRole("button", { name: /Concepts across the class/, expanded: false }),
    ).toBeInTheDocument();
    // Collapsed still means the graph loaded (it is mounted, hidden) — the
    // section header stays so the teacher can open it again.
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it("still renders when storage throws", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    mockFetch.mockResolvedValue(ok(ROLLUP));
    renderEn();
    fireEvent.click(await screen.findByRole("button", { name: /Concepts across the class/, expanded: true }));
    expect(screen.getByRole("button", { name: /Concepts across the class/, expanded: false })).toBeInTheDocument();
  });
});
