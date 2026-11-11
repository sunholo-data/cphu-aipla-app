// 1.1.139 M2 (first slice) — the class's concepts moved from the bottom of the
// class page to the top. JB: "the UI of finding concepts [should be] easier".
// This pins the PLACEMENT (above the groups list), the single occurrence (no
// copy left at the bottom), and the empty case (no card at the top).

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { ClassPayload } from "@/lib/teacherApi";

const CLASS_ID = "class-7b-physics-a";

// UI sweep 2026-11: the lesson card and the concepts lead the "After the
// lesson" view, which is where these tests open.
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: CLASS_ID }),
  useSearchParams: () => new URLSearchParams({ tab: "after" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => `/teacher/classes/${CLASS_ID}`,
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));
vi.mock("../_ClassAnalyticsCopilot", () => ({ ClassAnalyticsCopilot: () => null }));
vi.mock("@/hooks/useTeacherAuth", () => ({
  useTeacherAuth: () => ({ user: { uid: "teacher-1" }, loading: false }),
}));

// The graph has its own tests; here it only reports how many concepts it holds.
let conceptCount = 2;
vi.mock("@/components/teacher/ClassConceptGraph", async () => {
  const { useEffect } = await import("react");
  return {
    ClassConceptGraph: ({ onLoaded }: { onLoaded?: (n: number | null) => void }) => {
      useEffect(() => {
        onLoaded?.(conceptCount);
      }, [onLoaded]);
      return <div data-testid="class-concept-graph-stub" />;
    },
  };
});

import TeacherClassDetailPage from "@/app/teacher/classes/[id]/page";
import { LocaleProvider } from "@/i18n";

function makeClassPayload(): ClassPayload {
  return {
    classId: CLASS_ID,
    ownerUid: "teacher-1",
    name: "Physics A — 7B",
    description: null,
    tagNamespace: `class:teacher-1:${CLASS_ID}`,
    lessons: [],
    activityIds: [],
    groupCodes: ["bright-fox-12"],
    revoked: false,
    createdAt: "2026-05-26T00:00:00Z",
    updatedAt: "2026-05-26T00:00:00Z",
    revokedAt: null,
  };
}

function renderPage() {
  return render(
    <LocaleProvider locale="en">
      <TeacherClassDetailPage />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("offline (test)");
    }),
  );
  vi.spyOn(teacherApi, "getClass").mockResolvedValue(makeClassPayload());
  vi.spyOn(teacherApi, "listActivities").mockResolvedValue({
    activities: [],
    total: 0,
    limit: 200,
    offset: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  conceptCount = 2;
});

// The whole class page mounts here (class fetch → concept graph → onLoaded) before
// the section can show. Cloud Build is slow enough that findBy*'s 1 s default
// timed out and failed the dev deploy of bd2410d (2026-09-30), so the waits are
// generous. They cost nothing when the page is fast.
const SLOW = { timeout: 10_000 };

describe("/teacher/classes/[id] — concepts lead 'After the lesson'", () => {
  it("renders 'Concepts across the class' in the After view, above the numbers, once", async () => {
    renderPage();
    const concepts = await screen.findByRole("heading", { name: "Concepts across the class" }, SLOW);
    const after = screen.getByRole("tabpanel", { name: "After the lesson" });
    expect(after).toContainElement(concepts);
    const numbers = screen.getByRole("heading", { name: "Numbers" });
    expect(concepts.compareDocumentPosition(numbers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One place only — the old bottom section is gone.
    expect(screen.getAllByTestId("class-concept-graph-stub")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Concept map for the class" })).toBeNull();
  }, 20_000);

  it("shows no card when the class has no concepts — one muted line", async () => {
    conceptCount = 0;
    renderPage();
    const hint = await screen.findByTestId("class-concepts-hint", {}, SLOW);
    expect(screen.getByRole("tabpanel", { name: "After the lesson" })).toContainElement(hint);
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Concepts across the class" })).toBeNull(),
    );
  }, 20_000);
});

describe("/teacher/classes/[id] — the latest lesson leads (1.1.139 M2)", () => {
  it("renders the Latest lesson card above the concepts, from a cached-only read", async () => {
    const lessonApi = await import("@/lib/lessonOverviewApi");
    const { makeLesson } = await import("@/components/teacher/lessons/__tests__/fixtures");
    vi.spyOn(lessonApi, "fetchClassLessons").mockResolvedValue([
      {
        activityId: "act-1",
        activityTitle: "Waves",
        date: "2026-10-20",
        groups: 3,
        sessions: 3,
        turns: 30,
        startedAt: null,
        lastAt: null,
      },
    ]);
    const fetchLesson = vi.spyOn(lessonApi, "fetchLesson").mockResolvedValue(makeLesson({ classId: CLASS_ID }));
    renderPage();
    const card = await screen.findByTestId("latest-lesson-card", {}, SLOW);
    const concepts = await screen.findByRole("heading", { name: "Concepts across the class" }, SLOW);
    expect(card.compareDocumentPosition(concepts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fetchLesson).toHaveBeenCalledWith(CLASS_ID, "act-1", "2026-10-20", { synthesis: "cached" });
  }, 20_000);
});
