import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LedPlanckLabFrame,
  type LedPlanckLabFrameHandle,
} from "../LedPlanckLabFrame";

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

describe("LedPlanckLabFrame (bench-only)", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("<!doctype html><html><body>lab</body></html>", {
          status: 200,
        }),
      ),
    ) as unknown as typeof fetch;
  });

  it("renders the StaticArtefactFrame iframe pointing at /sandbox.html", () => {
    render(
      <LedPlanckLabFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        reportEvent={() => {}}
        onClose={() => {}}
      />,
    );
    const iframe = screen.getByTitle(/LED Planck/i) as HTMLIFrameElement;
    expect(iframe.src).toBe(`${SANDBOX_ORIGIN}/sandbox.html`);
  });

  it("outer iframe has spec-compliant sandbox attrs (allow-scripts + allow-same-origin)", () => {
    render(
      <LedPlanckLabFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        reportEvent={() => {}}
        onClose={() => {}}
      />,
    );
    const iframe = screen.getByTitle(/LED Planck/i);
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
  });

  it("close button fires onClose", () => {
    const onClose = vi.fn();
    render(
      <LedPlanckLabFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        reportEvent={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Luk laboratorium/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("event routing to reportEvent", () => {
    it("routes step-change", () => {
      const reportEvent = vi.fn();
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.step-change",
        step: 2,
        stepName: "part1",
      });
      expect(reportEvent).toHaveBeenCalledWith({
        kind: "led-planck.step-change",
        step: 2,
        stepName: "part1",
      });
    });

    it("routes component-placed with correct flag", () => {
      const reportEvent = vi.fn();
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.component-placed",
        component: "voltmeter",
        correct: true,
      });
      expect(reportEvent).toHaveBeenCalledWith({
        kind: "led-planck.component-placed",
        component: "voltmeter",
        correct: true,
      });
    });

    it("routes led-polarity-error", () => {
      const reportEvent = vi.fn();
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({ kind: "led-planck.led-polarity-error" });
      expect(reportEvent).toHaveBeenCalledWith({
        kind: "led-planck.led-polarity-error",
      });
    });

    it("routes state-change", () => {
      const reportEvent = vi.fn();
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.state-change",
        changed: ["voltage"],
        state: { voltage: 3.2 },
        triggeredBy: "record",
      });
      expect(reportEvent).toHaveBeenCalledWith({
        kind: "led-planck.state-change",
        changed: ["voltage"],
        state: { voltage: 3.2 },
        triggeredBy: "record",
      });
    });

    it("routes reading", () => {
      const reportEvent = vi.fn();
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.reading",
        led: "red",
        I: 0.01,
        U: 1.85,
        Vs: 3.2,
      });
      expect(reportEvent).toHaveBeenCalledWith({
        kind: "led-planck.reading",
        led: "red",
        I: 0.01,
        U: 1.85,
        Vs: 3.2,
      });
    });

    it("routes auto-run", () => {
      const reportEvent = vi.fn();
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      const points = [
        { I: 0.001, U: 1.5, Vs: 2 },
        { I: 0.01, U: 1.9, Vs: 3.3 },
      ];
      dispatchUpdateModelContext({
        kind: "led-planck.auto-run",
        led: "green",
        points,
      });
      expect(reportEvent).toHaveBeenCalledWith({
        kind: "led-planck.auto-run",
        led: "green",
        points,
      });
    });

    it("routes fit", () => {
      const reportEvent = vi.fn();
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.fit",
        led: "blue",
        u0: 2.64,
      });
      expect(reportEvent).toHaveBeenCalledWith({
        kind: "led-planck.fit",
        led: "blue",
        u0: 2.64,
      });
    });

    it("routes spectrum", () => {
      const reportEvent = vi.fn();
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.spectrum",
        led: "blue",
        lambda: 470,
      });
      expect(reportEvent).toHaveBeenCalledWith({
        kind: "led-planck.spectrum",
        led: "blue",
        lambda: 470,
      });
    });

    it("routes calibrated", () => {
      const reportEvent = vi.fn();
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({ kind: "led-planck.calibrated" });
      expect(reportEvent).toHaveBeenCalledWith({
        kind: "led-planck.calibrated",
      });
    });

    it("does NOT route measurement (that comes from the React Results surface)", () => {
      const reportEvent = vi.fn();
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.measurement",
        data: { led: "red", u0: 1.99, lambda: 625, h_computed: 6.6e-34 },
      });
      expect(reportEvent).not.toHaveBeenCalled();
    });
  });

  describe("sendChatFlush ref method (Phase 2 chat-submit gating)", () => {
    it("dispatches a ui/notifications/chat-flush postMessage at the proxy origin", () => {
      const ref = createRef<LedPlanckLabFrameHandle>();
      render(
        <LedPlanckLabFrame
          ref={ref}
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={() => {}}
          onClose={() => {}}
        />,
      );

      const iframe = screen.getByTitle(/LED Planck/i) as HTMLIFrameElement;
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
  });

  it("rejects messages from origins other than sandboxOrigin (origin-based auth)", () => {
    const reportEvent = vi.fn();
    render(
      <LedPlanckLabFrame
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
              kind: "led-planck.reading",
              led: "red",
              I: 0.01,
              U: 1.85,
              Vs: 3.2,
            },
          },
        },
        origin: "https://evil.example.com",
      }),
    );
    expect(reportEvent).not.toHaveBeenCalled();
  });
});
