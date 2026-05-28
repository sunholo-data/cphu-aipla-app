import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KineBotFrame, type KineBotFrameHandle } from "../KineBotFrame";

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

describe("KineBotFrame (sim-only)", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response("<!doctype html><html><body>kb</body></html>", { status: 200 })),
    ) as unknown as typeof fetch;
  });

  it("mounts the StaticArtefactFrame iframe at /sandbox.html", () => {
    render(
      <KineBotFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        topic="intro"
        reportEvent={() => {}}
        onClose={() => {}}
      />,
    );
    const iframe = screen.getByTitle(/kinematics simulation/i) as HTMLIFrameElement;
    expect(iframe.src).toBe(`${SANDBOX_ORIGIN}/sandbox.html`);
  });

  it("close button fires onClose", () => {
    const onClose = vi.fn();
    render(
      <KineBotFrame sandboxOrigin={SANDBOX_ORIGIN} topic="intro" reportEvent={() => {}} onClose={onClose} />,
    );
    fireEvent.click(screen.getByLabelText(/close simulation/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("routes sim-run to reportEvent", () => {
    const reportEvent = vi.fn();
    render(
      <KineBotFrame sandboxOrigin={SANDBOX_ORIGIN} topic="projectile" reportEvent={reportEvent} onClose={() => {}} />,
    );
    dispatchUpdateModelContext({
      kind: "kinebot.sim-run",
      simType: "projectile",
      params: { velocity: 20, angle: 45 },
    });
    expect(reportEvent).toHaveBeenCalledWith({
      kind: "kinebot.sim-run",
      simType: "projectile",
      params: { velocity: 20, angle: 45 },
    });
  });

  it("routes state-change to reportEvent", () => {
    const reportEvent = vi.fn();
    render(
      <KineBotFrame sandboxOrigin={SANDBOX_ORIGIN} topic="intro" reportEvent={reportEvent} onClose={() => {}} />,
    );
    dispatchUpdateModelContext({
      kind: "kinebot.state-change",
      changed: ["velocity"],
      state: { velocity: 12 },
      triggeredBy: "play",
    });
    expect(reportEvent).toHaveBeenCalledWith({
      kind: "kinebot.state-change",
      changed: ["velocity"],
      state: { velocity: 12 },
      triggeredBy: "play",
    });
  });

  it("ignores graph-change + quiz-attempt from the iframe (those are React now)", () => {
    const reportEvent = vi.fn();
    render(
      <KineBotFrame sandboxOrigin={SANDBOX_ORIGIN} topic="intro" reportEvent={reportEvent} onClose={() => {}} />,
    );
    dispatchUpdateModelContext({ kind: "kinebot.graph-change", graphType: "vt" });
    dispatchUpdateModelContext({
      kind: "kinebot.quiz-attempt",
      topic: "intro",
      questionId: "x",
      answeredCorrectly: true,
    });
    expect(reportEvent).not.toHaveBeenCalled();
  });

  describe("ref methods", () => {
    it("sendChatFlush posts ui/notifications/chat-flush to the proxy origin", () => {
      const ref = createRef<KineBotFrameHandle>();
      render(
        <KineBotFrame ref={ref} sandboxOrigin={SANDBOX_ORIGIN} topic="intro" reportEvent={() => {}} onClose={() => {}} />,
      );
      const iframe = screen.getByTitle(/kinematics simulation/i) as HTMLIFrameElement;
      const postSpy = vi.fn();
      Object.defineProperty(iframe, "contentWindow", {
        configurable: true,
        value: { postMessage: postSpy },
      });
      ref.current!.sendChatFlush();
      expect(postSpy).toHaveBeenCalledWith(
        { jsonrpc: "2.0", method: "ui/notifications/chat-flush", params: {} },
        SANDBOX_ORIGIN,
      );
    });

    it("setTopic posts kinebot.set-topic to the iframe (no snapshot side-effect here)", () => {
      const reportEvent = vi.fn();
      const ref = createRef<KineBotFrameHandle>();
      render(
        <KineBotFrame ref={ref} sandboxOrigin={SANDBOX_ORIGIN} topic="intro" reportEvent={reportEvent} onClose={() => {}} />,
      );
      const iframe = screen.getByTitle(/kinematics simulation/i) as HTMLIFrameElement;
      const postSpy = vi.fn();
      Object.defineProperty(iframe, "contentWindow", {
        configurable: true,
        value: { postMessage: postSpy },
      });
      ref.current!.setTopic("circular");
      expect(postSpy).toHaveBeenCalledWith(
        { jsonrpc: "2.0", method: "kinebot.set-topic", params: { topic: "circular" } },
        SANDBOX_ORIGIN,
      );
      // The Frame no longer owns the snapshot — it does NOT call reportEvent.
      expect(reportEvent).not.toHaveBeenCalled();
    });
  });

  it("rejects messages from a non-sandbox origin", () => {
    const reportEvent = vi.fn();
    render(
      <KineBotFrame sandboxOrigin={SANDBOX_ORIGIN} topic="intro" reportEvent={reportEvent} onClose={() => {}} />,
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          jsonrpc: "2.0",
          method: "ui/update-model-context",
          params: { structuredContent: { kind: "kinebot.sim-run", simType: "1d", params: {} } },
        },
        origin: "https://evil.example.com",
      }),
    );
    expect(reportEvent).not.toHaveBeenCalled();
  });
});
