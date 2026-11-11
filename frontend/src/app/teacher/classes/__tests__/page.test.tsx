import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type MockedFunction,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import TeacherClassesPage from "@/app/teacher/classes/page";
import * as teacherApi from "@/lib/teacherApi";
import * as insightsApi from "@/lib/insightsApi";
import * as costApi from "@/lib/costApi";
import type { ClassPayload } from "@/lib/teacherApi";
import { LocaleProvider } from "@/i18n";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish (the teacher's own DA | EN choice), so render inside an English locale.
function EnglishLocale({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}
const render = ((ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: EnglishLocale, ...options })) as typeof rtlRender;


// The floating class co-pilot has its own tests and pulls in AG-UI + teacher
// auth; stub it so these dashboard tests stay focused on the list/insights.
vi.mock("../_ManageClassCopilot", () => ({ ManageClassCopilot: () => null }));
// The getting-started card reads the stage; not under test here.
vi.mock("../_GettingStartedCard", () => ({ GettingStartedCard: () => null }));
// Scope and filter live in the URL (UI sweep 2026-11-11).
vi.mock("next/navigation", async () => (await import("@/test/nextNavigationMock")).navigationModule);
import { nav } from "@/test/nextNavigationMock";

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

type ListClassesMock = MockedFunction<typeof teacherApi.listClasses>;
type CreateClassMock = MockedFunction<typeof teacherApi.createClass>;

let listSpy: ListClassesMock;
let createSpy: CreateClassMock;

beforeEach(() => {
  nav.reset("/teacher/classes");
  listSpy = vi.spyOn(teacherApi, "listClasses") as unknown as ListClassesMock;
  createSpy = vi.spyOn(teacherApi, "createClass") as unknown as CreateClassMock;
  // Insights API: default to empty results so existing tests don't
  // accidentally exercise the compare section. Per-test overrides set
  // realistic payloads where needed.
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
  // Default the table's supporting fetches to empty so rows render
  // deterministically (and the recent-sessions fan-out doesn't hit the network).
  vi.spyOn(teacherApi, "listClassRecentSessions").mockResolvedValue([]);
  vi.spyOn(teacherApi, "listAccessibleSkills").mockResolvedValue([]);
  vi.spyOn(teacherApi, "fetchPersonaCatalogue").mockResolvedValue({
    personas: [],
    defaultId: null,
    interactionStyles: [],
  });
  vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({
    tutors: [],
    skillBoundTutors: [],
    frameworks: [],
  });
  vi.spyOn(teacherApi, "listActivities").mockResolvedValue({ activities: [], total: [].length, limit: 200, offset: 0 });
  vi.spyOn(costApi, "fetchTeacherSpend").mockResolvedValue({
    currency: "EUR",
    period: "this_month",
    total_eur: 0,
    per_class: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/teacher/classes — dashboard", () => {
  it("renders class cards from the /api/classes response", async () => {
    listSpy.mockResolvedValue([
      makeClass({ classId: "a", name: "Class A" }),
      makeClass({ classId: "b", name: "Class B", lessons: ["s1"], groupCodes: ["x-y-1"] }),
    ]);

    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Class A" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Class B" })).toBeInTheDocument();
  });

  // UI sweep 2026-11-11 — the class name (and the row) is the link; the
  // "Manage" button that went to the same URL is gone.
  it("opens a class from its name or anywhere on its row, with no separate Manage button", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "abc", name: "Alpha" })]);
    render(<TeacherClassesPage />);
    const link = await screen.findByRole("link", { name: "Alpha" });
    expect(link).toHaveAttribute("href", "/teacher/classes/abc");
    expect(screen.queryByRole("link", { name: /manage/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("class-activity"));
    expect(nav.push).toHaveBeenCalledWith("/teacher/classes/abc");
  });

  it("has no Delete on the list row — deleting a class lives on the class page's setup view", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "c-9", name: "Old Class", groupCodes: ["alpha-bee-1"] })]);
    render(<TeacherClassesPage />);
    await screen.findByRole("link", { name: "Old Class" });
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /actions/i })).not.toBeInTheDocument();
  });

  it("links each assigned activity to its editor carrying THIS class, so the editor shows the class's tutor", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "c-1", name: "Physik 9A", activityIds: ["act-x"] })]);
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue({
      activities: [{ activityId: "act-x", title: "Waves" } as teacherApi.ActivityPayload],
      total: 1,
      limit: 200,
      offset: 0,
    });
    render(<TeacherClassesPage />);
    const link = await screen.findByRole("link", { name: "Waves" });
    expect(link.getAttribute("href")).toBe("/teacher/activities/act-x?title=Waves&classId=c-1");
    // Following an activity link does not also open the class.
    await userEvent.click(link);
    expect(nav.push).not.toHaveBeenCalledWith("/teacher/classes/c-1");
  });

  it("shows an empty state when the teacher has no classes", async () => {
    listSpy.mockResolvedValue([]);
    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByText(/no classes yet/i)).toBeInTheDocument();
    });
  });

  it("shows a failed class read with Retry (and the server's words), never the empty state", async () => {
    listSpy.mockRejectedValueOnce(new Error("boom")).mockResolvedValue([makeClass({ classId: "a", name: "Back" })]);
    render(<TeacherClassesPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your classes could not be loaded");
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    expect(screen.queryByText(/no classes yet/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("submits the new-class form to createClass and refreshes the list", async () => {
    const user = userEvent.setup();
    listSpy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeClass({ classId: "new", name: "Brand new" })]);
    createSpy.mockResolvedValue(makeClass({ classId: "new", name: "Brand new" }));

    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByText(/no classes yet/i)).toBeInTheDocument();
    });

    // Click the top-right "New class" header button
    const newClassButtons = screen.getAllByRole("button", { name: /new class/i });
    await user.click(newClassButtons[0]!);

    const nameInput = await screen.findByLabelText(/class name/i);
    await user.type(nameInput, "Brand new");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        name: "Brand new",
        description: null,
      });
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Brand new" })).toBeInTheDocument();
    });
  });

  // UI sweep 2026-11-11 — the "insights & spend" panel was a second copy of
  // Insights → All classes, which now carries the spend column and totals.
  it("links to Insights → All classes instead of loading a second cross-class table here", async () => {
    listSpy.mockResolvedValue([
      makeClass({ classId: "a", name: "Class A" }),
      makeClass({ classId: "b", name: "Class B" }),
    ]);
    render(<TeacherClassesPage />);
    await screen.findByRole("link", { name: "Class A" });
    const link = screen.getByRole("link", { name: /Numbers across your classes, with spend/ });
    expect(link).toHaveAttribute("href", "/teacher/insights/classes");
    expect(screen.queryByRole("button", { name: /show insights/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("cross-class-table")).not.toBeInTheDocument();
    // No BigQuery or spend reads from the class list any more.
    expect(insightsApi.fetchInsightsCompare).not.toHaveBeenCalled();
    expect(insightsApi.fetchInsightsSummary).not.toHaveBeenCalled();
    expect(costApi.fetchTeacherSpend).not.toHaveBeenCalled();
  });

  it("surfaces each class's tutor + assigned activity titles (1.1.32)", async () => {
    listSpy.mockResolvedValue([
      makeClass({ classId: "c-1", name: "Physik 9A", activityIds: ["act-x"], persona: "mikkel" }),
    ]);
    vi.spyOn(teacherApi, "fetchPersonaCatalogue").mockResolvedValue({
      personas: [
        {
          id: "mikkel",
          name: "Mikkel",
          title: null,
          avatar: "/personas/mikkel.webp",
          language: "da",
          interactionStyle: "concise",
          bio: null,
        },
      ],
      defaultId: "sofie",
      interactionStyles: [],
    });
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue({ activities: [
      {
        activityId: "act-x",
        ownerUid: "teacher-1",
        skillId: "concept-dialogue",
        visibility: "private",
        classId: "",
        teacherUid: "teacher-1",
        title: "Mechanical Waves",
        teachingGoal: "g",
        language: "da",
        difficulty: "standard",
        pairedWorkbench: null,
        updatedAt: "2026-06-16T00:00:00Z",
      },
    ], total: [
      {
        activityId: "act-x",
        ownerUid: "teacher-1",
        skillId: "concept-dialogue",
        visibility: "private",
        classId: "",
        teacherUid: "teacher-1",
        title: "Mechanical Waves",
        teachingGoal: "g",
        language: "da",
        difficulty: "standard",
        pairedWorkbench: null,
        updatedAt: "2026-06-16T00:00:00Z",
      },
    ].length, limit: 200, offset: 0 });

    render(<TeacherClassesPage />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Physik 9A" })).toBeInTheDocument(),
    );
    // The row distinguishes the class by its persona (name + avatar) + its
    // activity title.
    expect(await screen.findByText("Mikkel")).toBeInTheDocument();
    expect(
      document.querySelector('img[src="/personas/mikkel.webp"]'),
    ).toBeInTheDocument();
    // The activity title links to its editor (click-through from the class list).
    const activityLink = await screen.findByRole("link", { name: /Mechanical Waves/ });
    expect(activityLink.getAttribute("href")).toContain("/teacher/activities/act-x");
  });

  it("shows the tutor the class actually CHOSE, not the legacy persona field (1.1.91)", async () => {
    // A class that picks a tutor gets `tutorId`; `setClassTutor` never writes
    // `persona`. Resolving the column from `persona` alone showed the old
    // identity (or the inherited default) for every class whose tutor was set —
    // the same "resolver with one consumer" shape as 1.1.112.
    listSpy.mockResolvedValue([
      makeClass({ classId: "c-2", name: "Fysik 2.g", persona: "mikkel", tutorId: "astrid-esru" }),
    ]);
    vi.spyOn(teacherApi, "fetchPersonaCatalogue").mockResolvedValue({
      personas: [
        {
          id: "mikkel",
          name: "Mikkel",
          title: null,
          avatar: "/personas/mikkel.webp",
          language: "da",
          interactionStyle: "concise",
          bio: null,
        },
      ],
      defaultId: "sofie",
      interactionStyles: [],
    });
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({
      tutors: [
        {
          id: "astrid-esru",
          displayName: "Astrid",
          personaId: "astrid",
          interactionStyle: "socratic",
          status: "ready",
          version: 1,
          isVariant: false,
          lineage: { kind: "original" },
          persona: { id: "astrid", name: "Astrid", title: null, avatar: "/personas/astrid.webp" },
          frameworkName: null,
          frameworkSummary: null,
        },
      ],
      skillBoundTutors: [],
      frameworks: [],
    });

    render(<TeacherClassesPage />);
    expect(await screen.findByText("Astrid")).toBeInTheDocument();
    expect(screen.queryByText("Mikkel")).not.toBeInTheDocument();
    // Chosen, not inherited — so the row carries no "· default" hint.
    expect(screen.queryByText("· default")).not.toBeInTheDocument();
  });

});

function sessionRow(i: number, groupCode: string | null = `g-${i}`): teacherApi.SessionRow {
  return {
    sessionId: `s-${i}`,
    skillId: "concept-dialogue",
    title: `Session ${i}`,
    groupCode,
    turnCount: i,
    lastMessageAt: new Date(Date.now() - i * 60_000).toISOString(),
  } as teacherApi.SessionRow;
}

describe("/teacher/classes — recent activity", () => {
  it("shows the latest 3 sessions, and 'Show all (n)' reveals the rest", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "a", name: "Class A" })]);
    vi.spyOn(teacherApi, "listClassRecentSessions").mockResolvedValue([1, 2, 3, 4, 5].map((i) => sessionRow(i)));
    render(<TeacherClassesPage />);
    await waitFor(() => expect(screen.getAllByRole("link", { name: /Session \d/ })).toHaveLength(3));
    // Newest first.
    expect(screen.getAllByRole("link", { name: /Session \d/ })[0]).toHaveTextContent("Session 1");
    const toggle = screen.getByRole("button", { name: "Show all (5)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getAllByRole("link", { name: /Session \d/ })).toHaveLength(5);
    expect(screen.getByRole("link", { name: /Session 5/ })).toHaveAttribute(
      "href",
      "/teacher/reports/groups/g-5?session_id=s-5",
    );
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getAllByRole("link", { name: /Session \d/ })).toHaveLength(3);
  });

  it("a failed sessions read shows Retry — not 'No student sessions yet'", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "a", name: "Class A" })]);
    const sessions = vi
      .spyOn(teacherApi, "listClassRecentSessions")
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValue([sessionRow(1)]);
    render(<TeacherClassesPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The sessions could not be loaded");
    expect(screen.queryByText(/No student sessions yet/)).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Session 1/ })).toBeInTheDocument();
    expect(sessions).toHaveBeenCalledTimes(2);
  });

  it("when only some classes fail, shows what loaded AND says how many classes are missing", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "a", name: "Class A" }), makeClass({ classId: "b", name: "Class B" })]);
    vi.spyOn(teacherApi, "listClassRecentSessions").mockImplementation(async (id: string) => {
      if (id === "b") throw new Error("503");
      return [sessionRow(1)];
    });
    render(<TeacherClassesPage />);
    expect(await screen.findByRole("link", { name: /Session 1/ })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The sessions from 1 class could not be loaded");
  });

  it("says 'no sessions yet' only when every read answered with none", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "a", name: "Class A" })]);
    render(<TeacherClassesPage />);
    expect(await screen.findByText(/No student sessions yet/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// 1.1.108 M2 — the teacher's screens speak the teacher's own language. Without
// an English choice they are Danish (the site default); with one, no Danish.
describe("/teacher/classes — language", () => {
  it("is Danish by default", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "a", name: "Hold A" })]);
    rtlRender(<TeacherClassesPage />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Hold A" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Klasser");
    expect(screen.getByRole("columnheader", { name: "Klasse" })).toBeInTheDocument();
    // "Aktivitet" | "Aktiviteter" two columns apart became "Sidst brugt" | "Aktiviteter".
    expect(screen.getByRole("columnheader", { name: "Sidst brugt" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Aktivitet" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tal på tværs af dine klasser, med forbrug → Indsigt/ })).toBeInTheDocument();
  });

  it("carries no Danish letters in its own chrome under English", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "a", name: "Class A" })]);
    const { container } = render(<TeacherClassesPage />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Class A" })).toBeInTheDocument());
    const attrs = [...container.querySelectorAll("[aria-label],[title],[placeholder]")]
      .map((el) => ["aria-label", "title", "placeholder"].map((a) => el.getAttribute(a) ?? "").join(" "))
      .join(" ");
    expect(container.textContent ?? "").not.toMatch(/[æøåÆØÅ]/);
    expect(attrs).not.toMatch(/[æøåÆØÅ]/);
  });
});
