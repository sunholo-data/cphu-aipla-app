import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KineBotWorkbench } from "../KineBotWorkbench";
import type { KineBotSnapshot } from "../KineBotFrame";

const EMPTY: KineBotSnapshot | null = null;

const MID_LAB: KineBotSnapshot = {
  lastEvent: "kinebot.quiz-attempt",
  currentTopic: "projectile",
  topicsVisited: ["intro", "velocity", "projectile"],
  lastSimRun: { simType: "projectile", params: { velocity: 20, angle: 45 } },
  currentGraph: "range",
  quizProgress: [
    { topic: "projectile", attempts: 3, correct: 2 },
    { topic: "intro", attempts: 2, correct: 2 },
  ],
};

describe("KineBotWorkbench", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("renders the topic sections + lesson framing in empty state", () => {
    render(
      <KineBotWorkbench
        snapshot={EMPTY}
        onTopicChange={() => {}}
        sessionId={null}
      />,
    );
    expect(screen.getByText(/Fundamentals/i)).toBeInTheDocument();
    expect(screen.getByText(/2D Motion/i)).toBeInTheDocument();
    expect(screen.getByText(/^Topics$/)).toBeInTheDocument();
    // "Intro to Motion" appears twice — as the sidebar row AND as the
    // lesson-framing heading for the default topic. Just confirm both
    // are present.
    expect(screen.getAllByText(/Intro to Motion/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Projectile Motion/i)).toBeInTheDocument();
  });

  it("highlights the current topic from snapshot.currentTopic", () => {
    render(
      <KineBotWorkbench
        snapshot={MID_LAB}
        onTopicChange={() => {}}
        sessionId="sess-1"
      />,
    );
    // The "now" tag appears on the active row.
    const projectileRow = screen
      .getAllByText(/Projectile Motion/i)[0]
      .closest("button");
    expect(projectileRow).toBeTruthy();
    expect(projectileRow!.textContent).toMatch(/now/i);
  });

  it("clicking a topic calls onTopicChange with the topic key", () => {
    const onTopicChange = vi.fn();
    render(
      <KineBotWorkbench
        snapshot={EMPTY}
        onTopicChange={onTopicChange}
        sessionId="sess-1"
      />,
    );
    fireEvent.click(screen.getByText(/Free Fall/i));
    expect(onTopicChange).toHaveBeenCalledWith("freefall");
  });

  it("progress card shows visited count + quiz aggregate", () => {
    render(
      <KineBotWorkbench
        snapshot={MID_LAB}
        onTopicChange={() => {}}
        sessionId="sess-1"
      />,
    );
    expect(screen.getByText(/Topics visited:/i)).toBeInTheDocument();
    // 3 visited out of 11 total topics
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/Quiz: 4\/5 correct/i)).toBeInTheDocument();
  });

  it("progress card hides quiz line when no attempts yet", () => {
    render(
      <KineBotWorkbench
        snapshot={EMPTY}
        onTopicChange={() => {}}
        sessionId="sess-1"
      />,
    );
    expect(screen.queryByText(/Quiz: \d+\/\d+/i)).not.toBeInTheDocument();
  });

  it("notes textarea persists to sessionStorage on Save", () => {
    render(
      <KineBotWorkbench
        snapshot={EMPTY}
        onTopicChange={() => {}}
        sessionId="sess-9"
      />,
    );
    const textarea = screen.getByPlaceholderText(/Write your notes here/i);
    fireEvent.change(textarea, { target: { value: "Projectile motion summary" } });
    fireEvent.click(screen.getByText(/^Save$/));
    expect(window.sessionStorage.getItem("kinebot:notes:sess-9")).toBe(
      "Projectile motion summary",
    );
  });

  it("notes restore from sessionStorage on mount", () => {
    window.sessionStorage.setItem("kinebot:notes:sess-5", "Saved earlier");
    window.sessionStorage.setItem("kinebot:noteTag:sess-5", "SUVAT");
    render(
      <KineBotWorkbench
        snapshot={EMPTY}
        onTopicChange={() => {}}
        sessionId="sess-5"
      />,
    );
    expect(
      (screen.getByPlaceholderText(/Write your notes here/i) as HTMLTextAreaElement)
        .value,
    ).toBe("Saved earlier");
    expect(
      (screen.getByPlaceholderText(/Tag/i) as HTMLInputElement).value,
    ).toBe("SUVAT");
  });

  it("Save/Clear buttons disabled when sessionId is null", () => {
    render(
      <KineBotWorkbench
        snapshot={EMPTY}
        onTopicChange={() => {}}
        sessionId={null}
      />,
    );
    expect((screen.getByText(/^Save$/) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText(/^Clear$/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("formula card shows current topic's formulas", () => {
    render(
      <KineBotWorkbench
        snapshot={MID_LAB}
        onTopicChange={() => {}}
        sessionId="sess-1"
      />,
    );
    // Projectile motion formulas: T, H, R
    expect(screen.getByText(/T = 2u sin θ \/ g/)).toBeInTheDocument();
    expect(screen.getByText(/H = u² sin²θ \/ 2g/)).toBeInTheDocument();
    expect(screen.getByText(/R = u² sin 2θ \/ g/)).toBeInTheDocument();
  });
});
