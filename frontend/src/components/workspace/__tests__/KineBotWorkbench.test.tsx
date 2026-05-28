import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KineBotWorkbench } from "../KineBotWorkbench";
import type { KineBotSnapshot } from "@/hooks/useKineBotSnapshot";

const SANDBOX = "https://aipla-v01-sandbox-test.run.app";

const MID: KineBotSnapshot = {
  lastEvent: "kinebot.sim-run",
  currentTopic: "projectile",
  topicsVisited: ["intro", "velocity", "projectile"],
  lastSimRun: { simType: "projectile", params: { velocity: 20, angle: 45 } },
  currentGraph: "range",
  quizProgress: [{ topic: "projectile", attempts: 3, correct: 2 }],
};

function noop() {}

beforeEach(() => {
  window.sessionStorage.clear();
  // Quiz fetches its bank — keep it from erroring in jsdom.
  global.fetch = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ topic: "intro", questions: [] }), { status: 200 }),
    ),
  ) as unknown as typeof fetch;
});

describe("KineBotWorkbench (split workbench)", () => {
  it("renders the how-this-works guidance", () => {
    render(
      <KineBotWorkbench
        snapshot={null}
        sandboxOrigin={SANDBOX}
        onOpenSim={noop}
        onTopicChange={noop}
        reportEvent={noop}
      />,
    );
    expect(screen.getByText(/How this works/i)).toBeInTheDocument();
    expect(screen.getByText(/Pick a topic below/i)).toBeInTheDocument();
  });

  it("renders the Open-simulation launcher and fires onOpenSim", () => {
    const onOpenSim = vi.fn();
    render(
      <KineBotWorkbench
        snapshot={null}
        sandboxOrigin={SANDBOX}
        onOpenSim={onOpenSim}
        onTopicChange={noop}
        reportEvent={noop}
      />,
    );
    fireEvent.click(screen.getByLabelText(/open kinebot kinematics workbench/i));
    expect(onOpenSim).toHaveBeenCalledTimes(1);
  });

  it("clicking a topic fires onTopicChange with the key", () => {
    const onTopicChange = vi.fn();
    render(
      <KineBotWorkbench
        snapshot={null}
        sandboxOrigin={SANDBOX}
        onOpenSim={noop}
        onTopicChange={onTopicChange}
        reportEvent={noop}
      />,
    );
    fireEvent.click(screen.getByText(/Free Fall/i));
    expect(onTopicChange).toHaveBeenCalledWith("freefall");
  });

  it("renders the graph + quiz sections", () => {
    render(
      <KineBotWorkbench
        snapshot={MID}
        sandboxOrigin={SANDBOX}
        onOpenSim={noop}
        onTopicChange={noop}
        reportEvent={noop}
      />,
    );
    // "Motion graphs" (graph section header, lowercase g) is distinct
    // from the "Motion Graphs" topic row (capital G).
    expect(screen.getByText("Motion graphs")).toBeInTheDocument();
    expect(screen.getByText(/^Quiz$/)).toBeInTheDocument();
  });

  it("progress card shows visited count + quiz aggregate", () => {
    render(
      <KineBotWorkbench
        snapshot={MID}
        sandboxOrigin={SANDBOX}
        onOpenSim={noop}
        onTopicChange={noop}
        reportEvent={noop}
      />,
    );
    expect(screen.getByText(/Topics visited:/i)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/Quiz: 2\/3 correct/i)).toBeInTheDocument();
  });

  it("notes persist to sessionStorage on Save", () => {
    render(
      <KineBotWorkbench
        snapshot={null}
        sandboxOrigin={SANDBOX}
        onOpenSim={noop}
        onTopicChange={noop}
        reportEvent={noop}
        sessionId="sess-9"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Write your notes here/i), {
      target: { value: "kinematics notes" },
    });
    fireEvent.click(screen.getByText(/^Save$/));
    expect(window.sessionStorage.getItem("kinebot:notes:sess-9")).toBe("kinematics notes");
  });

  it("graph type change reports a graph-change event", () => {
    const reportEvent = vi.fn();
    render(
      <KineBotWorkbench
        snapshot={null}
        sandboxOrigin={SANDBOX}
        onOpenSim={noop}
        onTopicChange={noop}
        reportEvent={reportEvent}
      />,
    );
    // The graph type <select> — change to v-t.
    const select = screen.getByDisplayValue(/Position-Time/i);
    fireEvent.change(select, { target: { value: "vt" } });
    expect(reportEvent).toHaveBeenCalledWith({
      kind: "kinebot.graph-change",
      graphType: "vt",
    });
  });
});
