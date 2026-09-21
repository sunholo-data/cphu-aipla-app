import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { TeacherStagePayload } from "@/lib/teacherApi";
import { GettingStartedCard } from "@/app/teacher/classes/_GettingStartedCard";

function stage(overrides: Partial<TeacherStagePayload>): TeacherStagePayload {
  return { stage: "demo_only", since: null, days: 3, nextStep: "Create the class", classes: [], ...overrides };
}

const ownClass = { classId: "c-1", name: "Fysik", demo: false, groupCodes: ["bright-fox-12"], activityIds: [] };

// The dismissal is a per-viewer convenience in localStorage; the component
// tolerates its absence, so the test supplies a plain in-memory one rather
// than relying on the runner's.
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
});
afterEach(() => vi.restoreAllMocks());

/**
 * 1.1.124 M1 — the teacher's checklist. Each undone step links to the CONTROL;
 * ticks come from the stage; it disappears on its own once students talk.
 */
describe("GettingStartedCard", () => {
  it("ticks nothing after the demo seed and offers 'New class' first", async () => {
    vi.spyOn(teacherApi, "fetchTeacherStage").mockResolvedValue(stage({}));
    const onCreate = vi.fn();
    render(<GettingStartedCard onCreateClass={onCreate} />);
    const card = await screen.findByTestId("getting-started-card");
    expect(card).toHaveTextContent("0 of 5");
    fireEvent.click(screen.getByRole("button", { name: "New class" }));
    expect(onCreate).toHaveBeenCalled();
  });

  it("at 'no activity' ticks two steps and offers Adopt before Create, into the first own class", async () => {
    vi.spyOn(teacherApi, "fetchTeacherStage").mockResolvedValue(
      stage({ stage: "no_activity", classes: [{ classId: "demo", name: "Demo class", demo: true, groupCodes: ["d"], activityIds: ["a"] }, ownClass] }),
    );
    render(<GettingStartedCard onCreateClass={() => {}} />);
    await screen.findByTestId("getting-started-card");
    expect(screen.getByTestId("step-createClass")).toHaveAttribute("data-done", "true");
    expect(screen.getByTestId("step-mintCode")).toHaveAttribute("data-done", "true");
    expect(screen.getByTestId("step-addActivity")).toHaveAttribute("data-done", "false");
    const links = screen.getAllByRole("link");
    const adopt = links.find((l) => l.textContent === "Adopt from the library");
    const create = links.find((l) => l.textContent === "Create one");
    expect(adopt).toHaveAttribute("href", "/teacher/activities#shared");
    expect(create).toHaveAttribute("href", "/teacher/activities/new?classId=c-1");
    // Adopt is offered BEFORE the builder.
    expect(links.indexOf(adopt!)).toBeLessThan(links.indexOf(create!));
  });

  it("at 'waiting' copies the join LINK carrying the origin and the code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.spyOn(teacherApi, "fetchTeacherStage").mockResolvedValue(stage({ stage: "waiting", classes: [ownClass] }));
    render(<GettingStartedCard onCreateClass={() => {}} />);
    await screen.findByTestId("getting-started-card");
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/group?code=bright-fox-12`));
  });

  it("at 'live' ticks everything, offers Hide, and stays hidden after", async () => {
    vi.spyOn(teacherApi, "fetchTeacherStage").mockResolvedValue(stage({ stage: "live", nextStep: null, classes: [ownClass] }));
    const { unmount } = render(<GettingStartedCard onCreateClass={() => {}} />);
    const card = await screen.findByTestId("getting-started-card");
    expect(card).toHaveTextContent("5 of 5");
    fireEvent.click(screen.getByRole("button", { name: /hide/i }));
    expect(screen.queryByTestId("getting-started-card")).not.toBeInTheDocument();
    unmount();
    render(<GettingStartedCard onCreateClass={() => {}} />);
    await waitFor(() => expect(teacherApi.fetchTeacherStage).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("getting-started-card")).not.toBeInTheDocument();
  });

  it("renders nothing when the stage cannot be read — no card beats a wrong card", async () => {
    vi.spyOn(teacherApi, "fetchTeacherStage").mockRejectedValue(new Error("boom"));
    const { container } = render(<GettingStartedCard onCreateClass={() => {}} />);
    await waitFor(() => expect(teacherApi.fetchTeacherStage).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
