// 1.1.141 M2/M3 — the teaching-goal warning, Move/Keep, the co-pilot move + Undo,
// and the visible tutor-notes field. The lint API is mocked; nothing here calls
// a model or the network.
import { act, render as rtlRender, renderHook, screen, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeachingGoalLint, TutorNotesField } from "@/components/teacher/TeachingGoalLint";
import { useActivityBuilder, type ActivityBuilder } from "@/hooks/useActivityBuilder";
import { LocaleProvider } from "@/i18n";
import type { GoalLintResult } from "@/lib/teacherApi";

const lintMock = vi.fn();
vi.mock("@/lib/teacherApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/teacherApi")>()),
  lintTeachingGoal: (...a: unknown[]) => lintMock(...a),
}));

import { moveBackToGoal, moveToNotes, runGoalLint, visibleSpans } from "@/lib/teachingGoalLint";

const GOAL = "Students measure the pendulum's period. Be very encouraging and give hints freely.";
const SPAN = "Be very encouraging and give hints freely.";

function result(over: Partial<GoalLintResult> = {}): GoalLintResult {
  return {
    spans: [{ text: SPAN, kind: "hint_policy", conflictsWith: ["elicit"], why: "" }],
    frameworkId: "esru",
    frameworkLabel: "ESRU",
    tutorName: "Mikkel",
    constructNames: { elicit: "Elicit" },
    textHash: "h",
    degraded: false,
    ...over,
  };
}

function lang(locale: "en" | "da") {
  return function Wrap({ children }: { children: React.ReactNode }) {
    return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
  };
}
const render = (ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: lang("en"), ...options });

function Harness({ hook }: { hook: { current: ActivityBuilder } }) {
  const b = hook.current;
  return (
    <>
      <span data-testid="goal">{b.teachingGoal}</span>
      <TeachingGoalLint builder={b} />
      <TutorNotesField builder={b} />
    </>
  );
}

function setup() {
  const hook = renderHook(() => useActivityBuilder());
  act(() => hook.result.current.setTeachingGoal(GOAL));
  const view = render(<Harness hook={hook.result} />);
  const rerender = () => view.rerender(<Harness hook={hook.result} />);
  return { hook, rerender };
}

beforeEach(() => lintMock.mockReset());

describe("pure helpers", () => {
  it("moves a line into notes and back", () => {
    const moved = moveToNotes(GOAL, "", [SPAN]);
    expect(moved.goal).toBe("Students measure the pendulum's period.");
    expect(moved.notes).toBe(SPAN);
    const back = moveBackToGoal(moved.goal, moved.notes, [SPAN]);
    expect(back.goal).toBe(GOAL);
    expect(back.notes).toBe("");
  });

  it("never cuts a line that is no longer in the goal", () => {
    expect(moveToNotes("Other text.", "", [SPAN])).toEqual({ goal: "Other text.", notes: "", moved: [] });
  });

  it("warns only about lines still present and not kept", () => {
    const st = { text: GOAL, result: result(), mode: "warn" as const, kept: [], moved: [] };
    expect(visibleSpans(st, GOAL)).toHaveLength(1);
    expect(visibleSpans(st, "edited away")).toHaveLength(0);
    expect(visibleSpans({ ...st, kept: [SPAN] }, GOAL)).toHaveLength(0);
  });

  it("runGoalLint sends the class and swallows failures", async () => {
    const set = vi.fn();
    lintMock.mockResolvedValueOnce(result());
    await runGoalLint(set, GOAL, { classId: "c1", activityId: "act-1" });
    expect(lintMock).toHaveBeenCalledWith({ text: GOAL, classId: "c1", activityId: "act-1" });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ text: GOAL, mode: "warn" }));

    lintMock.mockRejectedValueOnce(new Error("down"));
    set.mockClear();
    await runGoalLint(set, GOAL, {});
    expect(set).not.toHaveBeenCalled();
  });
});

describe("the warning beside the teaching goal", () => {
  it("names the tutor and the approach that takes precedence, and the line", () => {
    const { hook, rerender } = setup();
    act(() => hook.result.current.setGoalLint({ text: GOAL, result: result(), mode: "warn", kept: [], moved: [] }));
    rerender();
    expect(screen.getByText(/Mikkel teaches with ESRU, which will take precedence/)).toBeInTheDocument();
    expect(screen.getByText(SPAN)).toBeInTheDocument();
    expect(screen.getByText(/competes with Elicit/)).toBeInTheDocument();
  });

  it("says so honestly when the tutor has no approach", () => {
    const { hook, rerender } = setup();
    act(() =>
      hook.result.current.setGoalLint({
        text: GOAL,
        result: result({ frameworkId: null, frameworkLabel: null, tutorName: null, constructNames: {} }),
        mode: "warn",
        kept: [],
        moved: [],
      }),
    );
    rerender();
    expect(screen.getByText(/has no teaching approach/)).toBeInTheDocument();
  });

  it("Move to tutor notes moves the line into a visible, editable field", async () => {
    const { hook, rerender } = setup();
    act(() => hook.result.current.setGoalLint({ text: GOAL, result: result(), mode: "warn", kept: [], moved: [] }));
    rerender();
    await userEvent.click(screen.getByRole("button", { name: /Move to tutor notes/ }));
    rerender();
    expect(hook.result.current.teachingGoal).toBe("Students measure the pendulum's period.");
    expect(hook.result.current.tutorNotes).toBe(SPAN);
    expect(screen.getByLabelText("Tutor notes")).toHaveValue(SPAN);
    expect(screen.queryByRole("button", { name: /Move to tutor notes/ })).toBeNull();
    // Reversible.
    await userEvent.click(screen.getByRole("button", { name: /Move back to the teaching goal/ }));
    rerender();
    expect(hook.result.current.teachingGoal).toBe(GOAL);
    expect(hook.result.current.tutorNotes).toBe("");
  });

  it("Keep dismisses the warning and leaves the goal alone", async () => {
    const { hook, rerender } = setup();
    act(() => hook.result.current.setGoalLint({ text: GOAL, result: result(), mode: "warn", kept: [], moved: [] }));
    rerender();
    await userEvent.click(screen.getByRole("button", { name: /Keep/ }));
    rerender();
    expect(screen.queryByText(SPAN)).toBeNull();
    expect(hook.result.current.teachingGoal).toBe(GOAL);
  });
});

describe("M3 — a co-pilot draft is cleaned on import", () => {
  it("moves detected lines automatically, says what moved, and Undo restores", async () => {
    const { hook, rerender } = setup();
    act(() => hook.result.current.setGoalLint({ text: GOAL, result: result(), mode: "move", kept: [], moved: [] }));
    rerender();
    rerender();
    expect(hook.result.current.teachingGoal).toBe("Students measure the pendulum's period.");
    expect(hook.result.current.tutorNotes).toBe(SPAN);
    expect(screen.getByRole("status")).toHaveTextContent(/1 line that told the tutor how to teach was moved/);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    rerender();
    expect(hook.result.current.teachingGoal).toBe(GOAL);
    expect(hook.result.current.tutorNotes).toBe("");
  });

  it("does not move when the teacher already changed the draft", () => {
    const { hook, rerender } = setup();
    act(() =>
      hook.result.current.setGoalLint({ text: "an older draft", result: result(), mode: "move", kept: [], moved: [] }),
    );
    rerender();
    rerender();
    expect(hook.result.current.teachingGoal).toBe(GOAL);
    expect(hook.result.current.tutorNotes).toBe("");
  });

  it("toSavePayload carries tutorNotes, so a save cannot wipe them", () => {
    const { hook } = setup();
    act(() => hook.result.current.setTutorNotes("  Be brief. "));
    expect(hook.result.current.toSavePayload().tutorNotes).toBe("Be brief.");
  });

  it("speaks Danish to a Danish teacher", () => {
    const hook = renderHook(() => useActivityBuilder());
    act(() => {
      hook.result.current.setTeachingGoal(GOAL);
      hook.result.current.setGoalLint({ text: GOAL, result: result(), mode: "warn", kept: [], moved: [] });
    });
    rtlRender(<Harness hook={hook.result} />, { wrapper: lang("da") });
    expect(screen.getByText(/Mikkel underviser med ESRU, som vil have forrang/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Flyt til tutornoter/ })).toBeInTheDocument();
  });
});
