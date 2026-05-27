import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KineBotFrame,
  type KineBotFrameHandle,
} from "../KineBotFrame";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));
import { fetchWithAuth } from "@/lib/apiClient";

const dispatchMock = vi.fn();
vi.mock("@/hooks/useHumanToolEvents", () => ({
  useHumanToolEvents: () => ({ events: [], dispatch: dispatchMock, clear: vi.fn() }),
}));

const SANDBOX_ORIGIN = "https://aipla-v01-sandbox-test.run.app";

function dispatchUpdateModelContext(structuredContent: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        jsonrpc: "2.0",
        method: "ui/update-model-context",
        params: { structuredContent },
      },
      origin: SANDBOX_ORIGIN,
    }),
  );
}

describe("KineBotFrame", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockClear();
    dispatchMock.mockClear();
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("<!doctype html><html><body>kb</body></html>", { status: 200 }),
      ),
    ) as unknown as typeof fetch;
  });

  it("mounts the StaticArtefactFrame iframe pointing at /sandbox.html", () => {
    render(
      <KineBotFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        sessionId={null}
        onClose={() => {}}
      />,
    );
    const iframe = screen.getByTitle(/kinematics workbench/i) as HTMLIFrameElement;
    expect(iframe.src).toBe(`${SANDBOX_ORIGIN}/sandbox.html`);
  });

  it("outer iframe has spec-compliant sandbox attrs", () => {
    render(
      <KineBotFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        sessionId={null}
        onClose={() => {}}
      />,
    );
    const iframe = screen.getByTitle(/kinematics workbench/i);
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
  });

  it("close button fires onClose", () => {
    const onClose = vi.fn();
    render(
      <KineBotFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        sessionId={null}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText(/close workbench/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("event routing", () => {
    it("sim-run: snapshot.lastSimRun updates; silent push (no card)", () => {
      const onSnapshotChange = vi.fn();
      render(
        <KineBotFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
          onSnapshotChange={onSnapshotChange}
        />,
      );
      dispatchUpdateModelContext({
        kind: "kinebot.sim-run",
        simType: "projectile",
        params: { velocity: 20, acceleration: 0, angle: 45 },
      });
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
      expect(dispatchMock).not.toHaveBeenCalled();
      const snap = onSnapshotChange.mock.calls[0][0];
      expect(snap.lastSimRun).toEqual({
        simType: "projectile",
        params: { velocity: 20, acceleration: 0, angle: 45 },
      });
    });

    it("graph-change: snapshot.currentGraph + 'Viewing x-t graph' card", () => {
      render(
        <KineBotFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "kinebot.graph-change",
        graphType: "xt",
      });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe("Viewing x-t graph");
    });

    it("quiz-attempt correct: 'Quiz: correct on <topic>' card", () => {
      render(
        <KineBotFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "kinebot.quiz-attempt",
        topic: "projectile",
        questionId: "projectile-q1",
        answeredCorrectly: true,
      });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe(
        "Quiz: correct on Projectile Motion",
      );
    });

    it("quiz-attempt incorrect: silent push, no card (pedagogical silence)", () => {
      render(
        <KineBotFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "kinebot.quiz-attempt",
        topic: "projectile",
        questionId: "projectile-q2",
        answeredCorrectly: false,
      });
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("quiz-attempt: aggregates per-topic into snapshot.quizProgress", () => {
      const onSnapshotChange = vi.fn();
      render(
        <KineBotFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
          onSnapshotChange={onSnapshotChange}
        />,
      );
      dispatchUpdateModelContext({
        kind: "kinebot.quiz-attempt",
        topic: "freefall",
        questionId: "freefall-q1",
        answeredCorrectly: true,
      });
      dispatchUpdateModelContext({
        kind: "kinebot.quiz-attempt",
        topic: "freefall",
        questionId: "freefall-q2",
        answeredCorrectly: false,
      });
      const snap = onSnapshotChange.mock.calls[1][0];
      expect(snap.quizProgress).toEqual([
        { topic: "freefall", attempts: 2, correct: 1 },
      ]);
    });

    it("state-change (Phase-2 commit-on-submit): silent push, no card", () => {
      render(
        <KineBotFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "kinebot.state-change",
        changed: ["velocity"],
        state: { velocity: 12, acceleration: 3 },
        triggeredBy: "play",
      });
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("does not push (and no card) when sessionId is null", () => {
      render(
        <KineBotFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId={null}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "kinebot.graph-change",
        graphType: "vt",
      });
      expect(fetchWithAuth).not.toHaveBeenCalled();
      expect(dispatchMock).not.toHaveBeenCalled();
    });
  });

  describe("ref methods", () => {
    it("sendChatFlush posts ui/notifications/chat-flush to the proxy origin", () => {
      const ref = createRef<KineBotFrameHandle>();
      render(
        <KineBotFrame
          ref={ref}
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      const iframe = screen.getByTitle(/kinematics workbench/i) as HTMLIFrameElement;
      const postSpy = vi.fn();
      Object.defineProperty(iframe, "contentWindow", {
        configurable: true,
        value: { postMessage: postSpy },
      });

      ref.current!.sendChatFlush();

      expect(postSpy).toHaveBeenCalledTimes(1);
      const [msg, origin] = postSpy.mock.calls[0];
      expect(origin).toBe(SANDBOX_ORIGIN);
      expect(msg).toEqual({
        jsonrpc: "2.0",
        method: "ui/notifications/chat-flush",
        params: {},
      });
    });

    it("setTopic posts kinebot.set-topic + updates snapshot + POSTs iframe-context", () => {
      const onSnapshotChange = vi.fn();
      const ref = createRef<KineBotFrameHandle>();
      render(
        <KineBotFrame
          ref={ref}
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
          onSnapshotChange={onSnapshotChange}
        />,
      );
      const iframe = screen.getByTitle(/kinematics workbench/i) as HTMLIFrameElement;
      const postSpy = vi.fn();
      Object.defineProperty(iframe, "contentWindow", {
        configurable: true,
        value: { postMessage: postSpy },
      });

      ref.current!.setTopic("projectile");

      // Snapshot updated locally (host is source of truth for topic).
      const snap = onSnapshotChange.mock.calls[0][0];
      expect(snap.currentTopic).toBe("projectile");
      expect(snap.topicsVisited).toEqual(["projectile"]);

      // Iframe-context POSTed so agent sees the change.
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);

      // set-topic notification pushed into the iframe.
      expect(postSpy).toHaveBeenCalledTimes(1);
      const [msg] = postSpy.mock.calls[0];
      expect(msg).toEqual({
        jsonrpc: "2.0",
        method: "kinebot.set-topic",
        params: { topic: "projectile" },
      });
    });

    it("setTopic: topicsVisited dedupes when same topic is set twice", () => {
      const onSnapshotChange = vi.fn();
      const ref = createRef<KineBotFrameHandle>();
      render(
        <KineBotFrame
          ref={ref}
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
          onSnapshotChange={onSnapshotChange}
        />,
      );
      const iframe = screen.getByTitle(/kinematics workbench/i) as HTMLIFrameElement;
      Object.defineProperty(iframe, "contentWindow", {
        configurable: true,
        value: { postMessage: vi.fn() },
      });

      ref.current!.setTopic("acceleration");
      ref.current!.setTopic("acceleration");

      const lastSnap =
        onSnapshotChange.mock.calls[onSnapshotChange.mock.calls.length - 1][0];
      expect(lastSnap.topicsVisited).toEqual(["acceleration"]);
    });
  });

  it("rejects messages from origins other than sandboxOrigin", () => {
    render(
      <KineBotFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        sessionId="sess-1"
        onClose={() => {}}
      />,
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          jsonrpc: "2.0",
          method: "ui/update-model-context",
          params: {
            structuredContent: {
              kind: "kinebot.graph-change",
              graphType: "vt",
            },
          },
        },
        origin: "https://evil.example.com",
      }),
    );
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
});
