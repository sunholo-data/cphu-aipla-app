import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BoldkastSimFrame,
  type BoldkastSimFrameHandle,
} from "../BoldkastSimFrame";

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

describe("BoldkastSimFrame (bench-only)", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("<!doctype html><html><body>art</body></html>", {
          status: 200,
        }),
      ),
    ) as unknown as typeof fetch;
  });

  it("renders the StaticArtefactFrame iframe pointing at /sandbox.html", () => {
    render(
      <BoldkastSimFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        reportEvent={() => {}}
        onClose={() => {}}
      />,
    );
    const iframe = screen.getByTitle(/Boldkast.*simulator/i) as HTMLIFrameElement;
    expect(iframe.src).toBe(`${SANDBOX_ORIGIN}/sandbox.html`);
  });

  it("outer iframe has spec-compliant sandbox attrs (allow-scripts + allow-same-origin)", () => {
    render(
      <BoldkastSimFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        reportEvent={() => {}}
        onClose={() => {}}
      />,
    );
    const iframe = screen.getByTitle(/Boldkast.*simulator/i);
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
  });

  it("close button fires onClose", () => {
    const onClose = vi.fn();
    render(
      <BoldkastSimFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        reportEvent={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Luk simulator/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("event routing to reportEvent", () => {
    it("routes open", () => {
      const reportEvent = vi.fn();
      render(
        <BoldkastSimFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({ kind: "boldkast.open" });
      expect(reportEvent).toHaveBeenCalledWith({ kind: "boldkast.open" });
    });

    it("routes state-change", () => {
      const reportEvent = vi.fn();
      render(
        <BoldkastSimFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "boldkast.state-change",
        changed: ["v0", "theta"],
        state: { v0: 25, theta: 40, g: 9.82 },
        triggeredBy: "play",
      });
      expect(reportEvent).toHaveBeenCalledWith({
        kind: "boldkast.state-change",
        changed: ["v0", "theta"],
        state: { v0: 25, theta: 40, g: 9.82 },
        triggeredBy: "play",
      });
    });

    it("routes show_value", () => {
      const reportEvent = vi.fn();
      render(
        <BoldkastSimFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "boldkast.show_value",
        marker: "ymax",
        revealed: true,
      });
      expect(reportEvent).toHaveBeenCalledWith({
        kind: "boldkast.show_value",
        marker: "ymax",
        revealed: true,
      });
    });

    it("routes boldkast.play (sprint PROACTIVE-SIM-REACTIVE: play is the canonical sim_run signal)", () => {
      // Pre-2026-06-03 this event was filtered out as "not pedagogically
      // interesting". Then sim-reactive proactive turns landed: play IS
      // the canonical "student ran the sim" signal that triggers a
      // proactive tutor turn via useSimSnapshotPush's gate-check.
      const reportEvent = vi.fn();
      render(
        <BoldkastSimFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({ kind: "boldkast.play" });
      expect(reportEvent).toHaveBeenCalledWith({ kind: "boldkast.play" });
    });

    it("does NOT route pause / reset (undo + pause aren't progress)", () => {
      const reportEvent = vi.fn();
      render(
        <BoldkastSimFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({ kind: "boldkast.pause" });
      dispatchUpdateModelContext({ kind: "boldkast.reset" });
      expect(reportEvent).not.toHaveBeenCalled();
    });

    it("ignores a stale state-change without a changed array", () => {
      const reportEvent = vi.fn();
      render(
        <BoldkastSimFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({ kind: "boldkast.state-change" });
      expect(reportEvent).not.toHaveBeenCalled();
    });
  });

  describe("sendChatFlush ref method (Phase 2 chat-submit gating)", () => {
    it("dispatches a ui/notifications/chat-flush postMessage at the proxy origin", () => {
      const ref = createRef<BoldkastSimFrameHandle>();
      render(
        <BoldkastSimFrame
          ref={ref}
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={() => {}}
          onClose={() => {}}
        />,
      );
      const iframe = screen.getByTitle(/Boldkast.*simulator/i) as HTMLIFrameElement;
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

    it("ref method is safe to call when iframe contentWindow is unavailable", () => {
      const ref = createRef<BoldkastSimFrameHandle>();
      render(
        <BoldkastSimFrame
          ref={ref}
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={() => {}}
          onClose={() => {}}
        />,
      );
      const iframe = screen.getByTitle(/Boldkast.*simulator/i) as HTMLIFrameElement;
      Object.defineProperty(iframe, "contentWindow", {
        configurable: true,
        value: null,
      });
      expect(() => ref.current!.sendChatFlush()).not.toThrow();
    });
  });

  it("rejects messages from origins other than sandboxOrigin (origin-based auth)", () => {
    const reportEvent = vi.fn();
    render(
      <BoldkastSimFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        reportEvent={reportEvent}
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
              kind: "boldkast.show_value",
              marker: "ymax",
              revealed: true,
            },
          },
        },
        origin: "https://evil.example.com",
      }),
    );
    expect(reportEvent).not.toHaveBeenCalled();
  });
});
