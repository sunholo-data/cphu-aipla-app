import { render, screen, waitFor } from "@testing-library/react";
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

// The floating class co-pilot has its own tests and pulls in AG-UI + teacher
// auth; stub it so these dashboard tests stay focused on the list/insights.
vi.mock("../_ManageClassCopilot", () => ({ ManageClassCopilot: () => null }));

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
  vi.spyOn(teacherApi, "listActivities").mockResolvedValue([]);
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

  it("links each class card to its detail page", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "abc", name: "Alpha" })]);
    render(<TeacherClassesPage />);
    await waitFor(() => {
      const link = screen
        .getAllByRole("link", { name: /manage/i })
        .find((el) => el.getAttribute("href") === "/teacher/classes/abc");
      expect(link).toBeDefined();
    });
  });

  it("shows an empty state when the teacher has no classes", async () => {
    listSpy.mockResolvedValue([]);
    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByText(/no classes yet/i)).toBeInTheDocument();
    });
  });

  it("shows an error banner when /api/classes fails", async () => {
    listSpy.mockRejectedValue(new Error("boom"));
    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });
  });

  it("links to the analytics chat surface", async () => {
    listSpy.mockResolvedValue([]);
    render(<TeacherClassesPage />);
    await waitFor(() => {
      const link = screen.getByRole("link", {
        name: /chat with all session data/i,
      });
      expect(link).toHaveAttribute("href", "/teacher/analytics");
    });
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

  it("loads the integrated insights panel with per-class table + spend on demand", async () => {
    listSpy.mockResolvedValue([
      makeClass({ classId: "a", name: "Class A" }),
      makeClass({ classId: "b", name: "Class B" }),
    ]);
    vi.spyOn(insightsApi, "fetchInsightsCompare").mockResolvedValue({
      since: "2026-05-26T00:00:00+00:00",
      until: "2026-06-02T00:00:00+00:00",
      rows: [
        { classId: "a", name: "Class A", activeGroups: 2, messages: 50, messagesPrior: 40, messagesDelta: 10, simRuns: 3, lastActivity: null },
        { classId: "b", name: "Class B", activeGroups: 1, messages: 20, messagesPrior: 30, messagesDelta: -10, simRuns: 0, lastActivity: null },
      ],
    });
    vi.spyOn(costApi, "fetchTeacherSpend").mockResolvedValue({
      currency: "EUR",
      period: "this_month",
      total_eur: 1.23,
      per_class: [
        { class_id: "a", eur: 1.0 },
        { class_id: "b", eur: 0.23 },
      ],
    });

    render(<TeacherClassesPage />);
    // Insights + spend are deferred (BigQuery) — opt in to load the panel.
    await userEvent.click(await screen.findByRole("button", { name: /show insights/i }));
    await waitFor(() => {
      expect(screen.getByTestId("insights-panel")).toBeInTheDocument();
    });
    // Teacher-LEVEL spend total is surfaced in the panel (not just per-class).
    expect(screen.getByText("€1.23")).toBeInTheDocument();
    // …and the per-class engagement+spend table is integrated in the SAME panel
    // (Class A now appears both in the config table AND the per-class table).
    expect(screen.getByTestId("cross-class-compare-section")).toBeInTheDocument();
    expect(screen.getAllByText("Class A").length).toBeGreaterThan(1);
    // Per-class spend is in the table too.
    expect(screen.getByText("€1.00")).toBeInTheDocument();
  });

  it("hides the cross-class compare section when only 1 class exists", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "a", name: "Only class" })]);
    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Only class" })).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cross-class-compare-section")).not.toBeInTheDocument();
  });

  it("surfaces each class's tutor persona + assigned activity titles (1.1.32)", async () => {
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
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue([
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
    ]);

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

  it("deletes a class only after confirming the warning (1.1.32)", async () => {
    listSpy.mockResolvedValue([
      makeClass({ classId: "c-9", name: "Old Class", groupCodes: ["alpha-bee-1"] }),
    ]);
    const deleteSpy = vi
      .spyOn(teacherApi, "deleteClass")
      .mockResolvedValue({ revoked: true, classId: "c-9" });

    render(<TeacherClassesPage />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Old Class" })).toBeInTheDocument(),
    );

    // Clicking the row Delete opens a confirmation — it does NOT delete yet.
    await userEvent.click(screen.getByRole("button", { name: "Delete Old Class" }));
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/can.t be undone/i)).toBeInTheDocument();

    // Confirming deletes + refreshes.
    await userEvent.click(screen.getByRole("button", { name: "Delete class" }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("c-9"));
  });
});
