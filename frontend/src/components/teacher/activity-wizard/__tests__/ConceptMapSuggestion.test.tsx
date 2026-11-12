// Wizard step 1 — the concept map suggested from the goal (2026-11-12).
//
// The flag is read at module scope, so it is set before GoalStep is imported
// (vi.hoisted runs above the import hoisting). The page-level wizard tests run
// with the flag OFF and pin that nothing of this renders there.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONCEPT_MAP = "1";
});

const suggestMock = vi.fn();
vi.mock("@/lib/teacherApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teacherApi")>("@/lib/teacherApi");
  return {
    ...actual,
    suggestConceptMap: (body: unknown, signal?: AbortSignal) => suggestMock(body, signal),
    lintTeachingGoal: () => Promise.resolve({ spans: [], degraded: true }),
  };
});

import { GoalStep } from "@/components/teacher/activity-wizard/GoalStep";
import {
  SUGGEST_DEBOUNCE_MS,
  prerequisiteOrder,
} from "@/components/teacher/activity-wizard/ConceptMapSuggestion";
import { CopilotEntryContext } from "@/components/teacher/copilot/CopilotEntryContext";
import { Toaster } from "@/components/ui/toast";
import { useActivityBuilder, type ActivityBuilder } from "@/hooks/useActivityBuilder";
import { LocaleProvider } from "@/i18n";
import { ACTIVITY_TEMPLATES } from "@/lib/activityTemplates";
import type { ClassPayload, SuggestedConceptMap } from "@/lib/teacherApi";

const GOAL = "Students should understand why a ball in free fall accelerates and compute its fall time";
const GOAL_2 = "Students should understand how air resistance changes the motion of a falling ball";

const MAP: SuggestedConceptMap = {
  title: "Free fall",
  nodes: [
    { id: "free_fall", label: "Free fall", doneWhen: "Can compute the fall time from a height.", checkQuestions: [] },
    { id: "gravity", label: "Gravity", doneWhen: "Can say gravity pulls every body down.", checkQuestions: [] },
    { id: "acceleration", label: "Acceleration", doneWhen: "", checkQuestions: [] },
  ],
  edges: [
    { from: "gravity", to: "free_fall" },
    { from: "acceleration", to: "free_fall" },
  ],
};
const MAP_2: SuggestedConceptMap = {
  title: "Air resistance",
  nodes: [
    { id: "drag", label: "Drag", doneWhen: "Can explain drag.", checkQuestions: [] },
    { id: "terminal", label: "Terminal velocity", doneWhen: "Can explain terminal velocity.", checkQuestions: [] },
  ],
  edges: [{ from: "drag", to: "terminal" }],
};

const CLASSES = [{ classId: "c-1", name: "7B" }] as unknown as ClassPayload[];

let builderRef: ActivityBuilder | null = null;

function Harness({ auto = true }: { auto?: boolean }) {
  const b = useActivityBuilder();
  builderRef = b;
  return (
    <GoalStep
      builder={b}
      classes={CLASSES}
      classId="c-1"
      onClassChange={() => {}}
      onGoalChange={b.setTeachingGoal}
      onNameChange={b.setTitle}
      nameSuggested={false}
      appliedTemplateId={null}
      onPickTemplate={(tpl) => b.applyTemplate(tpl)}
      onStartBlank={() => {}}
      conceptMapAuto={auto}
    />
  );
}

function mount({ auto = true, copilot }: { auto?: boolean; copilot?: { open: (p?: string) => void } | null } = {}) {
  const ui = (
    <LocaleProvider locale="en">
      <Harness auto={auto} />
      <Toaster />
    </LocaleProvider>
  );
  if (copilot === undefined) return render(ui);
  return render(
    <CopilotEntryContext.Provider
      value={{
        registered: copilot ? { title: "Co-pilot", open: copilot.open } : null,
        register: () => () => {},
        ask: () => Boolean(copilot),
        bottomInset: 0,
        setInset: () => {},
      }}
    >
      {ui}
    </CopilotEntryContext.Provider>,
  );
}

const goalField = () => screen.getByLabelText(/what should the students learn/i);
const card = () => screen.getByTestId("wizard-concept-map");

/** Promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function pause() {
  await act(async () => {
    vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS);
  });
  await flush();
}

describe("wizard step 1 — suggested concept map", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    suggestMock.mockReset();
    builderRef = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks once the teacher pauses on a goal of eight words or more, and not again for the same goal", async () => {
    suggestMock.mockResolvedValue({ ok: true, map: MAP });
    mount();
    expect(within(card()).getByText(/write a little more about the goal/i)).toBeInTheDocument();

    fireEvent.change(goalField(), { target: { value: "Free fall and gravity" } });
    await pause();
    expect(suggestMock).not.toHaveBeenCalled();

    fireEvent.change(goalField(), { target: { value: GOAL } });
    await act(async () => {
      vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS - 100);
    });
    expect(suggestMock).not.toHaveBeenCalled();
    await pause();
    expect(suggestMock).toHaveBeenCalledTimes(1);
    expect(suggestMock.mock.calls[0][0]).toMatchObject({ goal: GOAL, language: "da" });

    // The suggestion, readable: in prerequisite order, with what each builds on.
    const items = within(within(card()).getByRole("list")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Gravity"),
      expect.stringContaining("Acceleration"),
      expect.stringContaining("Free fall"),
    ]);
    expect(within(card()).getByText(/builds on Gravity, Acceleration/i)).toBeInTheDocument();
    expect(within(card()).getByText(/understood when: can compute the fall time/i)).toBeInTheDocument();

    // Leaving the field or pausing again with the same goal asks nothing.
    fireEvent.blur(goalField());
    await pause();
    expect(suggestMock).toHaveBeenCalledTimes(1);
  });

  it("asks at once when the teacher leaves the goal field", async () => {
    suggestMock.mockResolvedValue({ ok: true, map: MAP });
    mount();
    fireEvent.change(goalField(), { target: { value: GOAL } });
    fireEvent.blur(goalField());
    await flush();
    expect(suggestMock).toHaveBeenCalledTimes(1);
    // …and the pending pause does not ask a second time.
    await pause();
    expect(suggestMock).toHaveBeenCalledTimes(1);
  });

  it("shows a placeholder while it asks, and ignores an answer for a goal that has since changed", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    suggestMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mount();
    fireEvent.change(goalField(), { target: { value: GOAL } });
    await pause();
    expect(within(card()).getByText(/making a suggestion from the goal/i)).toBeInTheDocument();
    const firstSignal = suggestMock.mock.calls[0][1] as AbortSignal;

    fireEvent.change(goalField(), { target: { value: GOAL_2 } });
    await pause();
    expect(suggestMock).toHaveBeenCalledTimes(2);
    // One in flight at a time: the older request was aborted.
    expect(firstSignal.aborted).toBe(true);

    second.resolve({ ok: true, map: MAP_2 });
    await flush();
    first.resolve({ ok: true, map: MAP });
    await flush();
    expect(within(card()).getByText("Drag")).toBeInTheDocument();
    expect(within(card()).queryByText("Gravity")).toBeNull();
  });

  it("uses the suggestion, then edits and removes it with Undo", async () => {
    suggestMock.mockResolvedValue({ ok: true, map: MAP });
    mount();
    fireEvent.change(goalField(), { target: { value: GOAL } });
    await pause();

    fireEvent.click(within(card()).getByRole("button", { name: /use the suggestion/i }));
    const used = builderRef!.conceptMap!;
    expect(used.title).toBe("Free fall");
    expect(used.nodes.map((n) => n.id)).toEqual(["free_fall", "gravity", "acceleration"]);
    expect(used.nodes.find((n) => n.id === "free_fall")!.dependsOn).toEqual(["gravity", "acceleration"]);
    expect(used.nodes[0].doneWhen).toBe("Can compute the fall time from a height.");
    // Now it is the activity's map: Edit and Remove, no suggestion actions.
    expect(within(card()).queryByRole("button", { name: /use the suggestion/i })).toBeNull();
    // The pressed button is gone; focus is on the card's heading, not <body>.
    expect(document.activeElement).toBe(within(card()).getByRole("heading", { name: /concept map/i }));

    fireEvent.click(within(card()).getByRole("button", { name: /edit the concept map/i }));
    expect(within(card()).getAllByDisplayValue("Gravity").length).toBeGreaterThan(0);
    fireEvent.click(within(card()).getByRole("button", { name: /^done$/i }));

    fireEvent.click(within(card()).getByRole("button", { name: /remove the concept map/i }));
    expect(builderRef!.conceptMap).toBeNull();
    // The suggestion is offered again, without asking again.
    expect(within(card()).getByRole("button", { name: /use the suggestion/i })).toBeInTheDocument();
    expect(suggestMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(builderRef!.conceptMap!.nodes).toHaveLength(3);
  });

  it("Edit uses the suggestion and opens the editor; Make a new one asks again", async () => {
    suggestMock.mockResolvedValueOnce({ ok: true, map: MAP }).mockResolvedValueOnce({ ok: true, map: MAP_2 });
    mount();
    fireEvent.change(goalField(), { target: { value: GOAL } });
    await pause();

    fireEvent.click(within(card()).getByRole("button", { name: /make a new one/i }));
    await flush();
    expect(suggestMock).toHaveBeenCalledTimes(2);
    expect(within(card()).getByText("Terminal velocity")).toBeInTheDocument();

    fireEvent.click(within(card()).getByRole("button", { name: /edit the concept map/i }));
    expect(builderRef!.conceptMap!.nodes.map((n) => n.label)).toEqual(["Drag", "Terminal velocity"]);
    expect(within(card()).getAllByDisplayValue("Drag").length).toBeGreaterThan(0);
  });

  it("a failed suggestion is one quiet line with Try again, and leaves the map alone", async () => {
    suggestMock.mockResolvedValueOnce({ ok: false, error: "refused" }).mockRejectedValueOnce(new Error("500"));
    suggestMock.mockResolvedValueOnce({ ok: true, map: MAP });
    mount();
    fireEvent.change(goalField(), { target: { value: GOAL } });
    await pause();
    expect(within(card()).getByText(/the suggestion could not be made/i)).toBeInTheDocument();
    expect(builderRef!.conceptMap).toBeNull();

    fireEvent.click(within(card()).getByRole("button", { name: /try again/i }));
    await flush();
    expect(within(card()).getByText(/the suggestion could not be made/i)).toBeInTheDocument();

    fireEvent.click(within(card()).getByRole("button", { name: /try again/i }));
    await flush();
    expect(within(card()).getByText("Gravity")).toBeInTheDocument();
    expect(suggestMock).toHaveBeenCalledTimes(3);
  });

  it("shows a template's map instead of suggesting one", async () => {
    mount();
    const tpl = ACTIVITY_TEMPLATES.find((t) => t.id === "energy-concept")!;
    act(() => builderRef!.applyTemplate(tpl));
    fireEvent.change(goalField(), { target: { value: GOAL } });
    await pause();
    expect(suggestMock).not.toHaveBeenCalled();
    expect(within(card()).getByText("Kinetisk energi")).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: /edit the concept map/i })).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: /remove the concept map/i })).toBeInTheDocument();
  });

  it("asks only on the button when the teacher's concept-map default is off", async () => {
    suggestMock.mockResolvedValue({ ok: true, map: MAP });
    mount({ auto: false });
    fireEvent.change(goalField(), { target: { value: GOAL } });
    fireEvent.blur(goalField());
    await pause();
    expect(suggestMock).not.toHaveBeenCalled();
    fireEvent.click(within(card()).getByRole("button", { name: /suggest concepts from the goal/i }));
    await flush();
    expect(suggestMock).toHaveBeenCalledTimes(1);
    expect(within(card()).getByText("Gravity")).toBeInTheDocument();
  });

  it("offers the AI help link only when a work co-pilot is mounted", () => {
    const open = vi.fn();
    const { unmount } = mount({ copilot: { open } });
    fireEvent.click(screen.getByRole("button", { name: /get help from ai with the goal and tools/i }));
    expect(open).toHaveBeenCalledTimes(1);
    unmount();

    mount({ copilot: null });
    expect(screen.queryByRole("button", { name: /get help from ai/i })).toBeNull();
  });
});

describe("prerequisiteOrder", () => {
  it("puts every concept after what it builds on, keeping the given order otherwise", () => {
    const order = prerequisiteOrder([
      { id: "c", dependsOn: ["a", "b"] },
      { id: "b", dependsOn: ["a"] },
      { id: "a", dependsOn: [] },
      { id: "d", dependsOn: [] },
    ]).map((n) => n.id);
    expect(order).toEqual(["a", "d", "b", "c"]);
  });

  it("never drops a node, even in a cycle", () => {
    const order = prerequisiteOrder([
      { id: "x", dependsOn: ["y"] },
      { id: "y", dependsOn: ["x"] },
    ]).map((n) => n.id);
    expect(order).toEqual(["x", "y"]);
  });
});
