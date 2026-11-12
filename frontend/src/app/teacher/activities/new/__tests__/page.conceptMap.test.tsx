// The new-activity wizard with the concept map ON (NEXT_PUBLIC_CONCEPT_MAP=1):
// a map suggested on step 1 is the activity's map on steps 2 and 3 and in the
// create payload, and a failed suggestion never stands in the way of Next.
// The card's own behaviour (debounce, stale answers, edit/remove) is pinned in
// components/teacher/activity-wizard/__tests__/ConceptMapSuggestion.test.tsx.
import { fireEvent, render as rtlRender, screen, waitFor, within, type RenderOptions } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONCEPT_MAP = "1";
});

vi.mock("next/navigation", async () => (await import("@/test/nextNavigationMock")).navigationModule);
import { nav } from "@/test/nextNavigationMock";

const suggestMock = vi.fn();
const createActivityMock = vi.fn();
vi.mock("@/lib/teacherApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teacherApi")>("@/lib/teacherApi");
  return {
    ...actual,
    listClasses: () => Promise.resolve([{ classId: "c-1", name: "Physics A — 7B" }]),
    listAccessibleSkills: () =>
      Promise.resolve([{ skillId: "concept-uuid", name: "concept-dialogue", displayName: "Begrebsdialog" }]),
    createActivity: (body: unknown) => createActivityMock(body),
    setActivityVisibility: () => Promise.resolve({}),
    fetchPersonaCatalogue: () => Promise.resolve({ personas: [], defaultId: null }),
    fetchTutorCatalogue: () => Promise.resolve({ tutors: [], skillBoundTutors: [] }),
    getClass: () => Promise.resolve({ classId: "c-1", persona: null }),
    listArtefacts: () => Promise.resolve([]),
    lintTeachingGoal: () => Promise.resolve({ spans: [], degraded: true }),
    suggestConceptMap: (body: unknown) => suggestMock(body),
  };
});

vi.mock("@/components/teacher/ActivityPreview", () => ({
  ActivityPreview: () => <div data-testid="activity-preview" />,
}));
vi.mock("@/components/teacher/ActivityOpeningEditor", () => ({
  ActivityOpeningEditor: () => <div data-testid="opening-editor" />,
}));
vi.mock("@/components/teacher/MaterialsSection", () => ({
  MaterialsSection: () => <div data-testid="materials-section" />,
}));

import NewActivityPage from "@/app/teacher/activities/new/page";
import { resetSimCatalogue } from "@/components/teacher/useSimCatalogue";
import { Toaster } from "@/components/ui/toast";
import { LocaleProvider } from "@/i18n";

function EnglishUI({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider locale="en">
      {children}
      <Toaster />
    </LocaleProvider>
  );
}
const render = (ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: EnglishUI, ...options });

const GOAL = "Students should understand why a ball in free fall accelerates and compute its fall time";
const MAP = {
  title: "Free fall",
  nodes: [
    { id: "gravity", label: "Gravity", doneWhen: "Can say gravity pulls every body down.", checkQuestions: [] },
    { id: "acceleration", label: "Acceleration", doneWhen: "Can explain acceleration.", checkQuestions: [] },
    { id: "free_fall", label: "Free fall", doneWhen: "Can compute the fall time.", checkQuestions: [] },
  ],
  edges: [
    { from: "gravity", to: "free_fall" },
    { from: "acceleration", to: "free_fall" },
  ],
};

const goalField = () => screen.getByLabelText(/what should the students learn/i);
const nextButton = () => screen.getByRole("button", { name: /next: tools/i }) as HTMLButtonElement;

async function writeGoal() {
  fireEvent.change(await screen.findByLabelText(/what should the students learn/i), { target: { value: GOAL } });
  fireEvent.blur(goalField()); // leaving the field asks at once
}

describe("/teacher/activities/new — the suggested concept map", () => {
  beforeEach(() => {
    nav.reset("/teacher/activities/new");
    resetSimCatalogue();
    suggestMock.mockReset();
    createActivityMock.mockReset();
    createActivityMock.mockResolvedValue({ activityId: "act-new-1" });
  });

  it("a used suggestion is the map on step 2, in step 3's summary and in the create", async () => {
    suggestMock.mockResolvedValue({ ok: true, map: MAP });
    render(<NewActivityPage />);
    await writeGoal();
    const card = screen.getByTestId("wizard-concept-map");
    fireEvent.click(await within(card).findByRole("button", { name: /use the suggestion/i }));

    fireEvent.click(nextButton());
    await screen.findByRole("heading", { name: /what will the students work with/i });
    expect(screen.getByTestId("workspace-tile-conceptMap")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /next: check and start/i }));
    await screen.findByRole("heading", { name: /check and start/i });
    expect(screen.getByTestId("wizard-summary-concept-map")).toHaveTextContent("Concept map: 3 concepts");

    fireEvent.click(screen.getByRole("button", { name: /create and give to/i }));
    await waitFor(() => expect(createActivityMock).toHaveBeenCalledTimes(1));
    const saved = createActivityMock.mock.calls[0][0].conceptMap;
    expect(saved).toHaveLength(1);
    expect(saved[0].nodes.map((n: { id: string }) => n.id)).toEqual(["gravity", "acceleration", "free_fall"]);
    expect(saved[0].edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "gravity", to: "free_fall" }),
        expect.objectContaining({ from: "acceleration", to: "free_fall" }),
      ]),
    );
  });

  it("step 3's concept-map row edits on step 1", async () => {
    suggestMock.mockResolvedValue({ ok: true, map: MAP });
    render(<NewActivityPage />);
    await writeGoal();
    fireEvent.click(await screen.findByRole("button", { name: /use the suggestion/i }));
    fireEvent.click(nextButton());
    fireEvent.click(await screen.findByRole("button", { name: /next: check and start/i }));
    fireEvent.click(await screen.findByRole("button", { name: /edit concept map/i }));
    expect(await screen.findByTestId("wizard-concept-map")).toBeInTheDocument();
    expect(nav.search.get("step")).toBeNull();
  });

  it("a failed suggestion does not block Next", async () => {
    suggestMock.mockRejectedValue(new Error("500"));
    render(<NewActivityPage />);
    await writeGoal();
    expect(await screen.findByText(/the suggestion could not be made/i)).toBeInTheDocument();
    expect(nextButton().disabled).toBe(false);
    fireEvent.click(nextButton());
    expect(await screen.findByRole("heading", { name: /what will the students work with/i })).toBeInTheDocument();
  });
});
