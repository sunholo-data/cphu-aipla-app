import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LedPlanckLabFrame,
  type LedPlanckLabFrameHandle,
} from "../LedPlanckLabFrame";

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

describe("LedPlanckLabFrame", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockClear();
    dispatchMock.mockClear();
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("<!doctype html><html><body>lab</body></html>", { status: 200 }),
      ),
    ) as unknown as typeof fetch;
  });

  it("renders the StaticArtefactFrame iframe pointing at /sandbox.html", () => {
    render(
      <LedPlanckLabFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        sessionId={null}
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
        sessionId={null}
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
        sessionId={null}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Luk laboratorium/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("human-tool-use card dispatch", () => {
    it("step-change part1 dispatches 'Begyndte I-U-måling'", () => {
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.step-change",
        step: 2,
        stepName: "part1",
      });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe("Begyndte I-U-måling");
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    });

    it("measurement event dispatches 'Målte U₀ for rød LED' and dedupes by LED color", () => {
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.measurement",
        data: { led: "red", u0: 1.99, lambda: 625, h_computed: 6.6e-34 },
      });
      // Second measurement on same LED — dedupes (newest wins), still
      // fires a card (re-measurement is a meaningful action).
      dispatchUpdateModelContext({
        kind: "led-planck.measurement",
        data: { led: "red", u0: 2.01, lambda: 625, h_computed: 6.7e-34 },
      });
      expect(dispatchMock).toHaveBeenCalledTimes(2);
      expect(dispatchMock.mock.calls[0][0].label).toBe("Målte U₀ for rød LED");
      expect(dispatchMock.mock.calls[1][0].label).toBe("Målte U₀ for rød LED");
      expect(fetchWithAuth).toHaveBeenCalledTimes(2);
    });

    it("component-placed correct:true dispatches 'Placerede voltmeter'", () => {
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.component-placed",
        component: "voltmeter",
        correct: true,
      });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe("Placerede voltmeter");
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    });

    it("component-placed correct:false: silent push, no card", () => {
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.component-placed",
        component: "voltmeter",
        correct: false,
      });
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("led-polarity-error dispatches 'Forsøgte LED med omvendt polaritet'", () => {
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({ kind: "led-planck.led-polarity-error" });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe(
        "Forsøgte LED med omvendt polaritet",
      );
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    });

    it("Phase 2: state-change is silent-push only (no card)", () => {
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.state-change",
        changed: ["voltage"],
        state: { voltage: 3.2 },
        triggeredBy: "record",
      });
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("does not push (and no card) when sessionId is null", () => {
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId={null}
          onClose={() => {}}
        />,
      );
      dispatchUpdateModelContext({
        kind: "led-planck.measurement",
        data: { led: "blue", u0: 2.64, lambda: 470, h_computed: 6.6e-34 },
      });
      expect(fetchWithAuth).not.toHaveBeenCalled();
      expect(dispatchMock).not.toHaveBeenCalled();
    });
  });

  describe("sendChatFlush ref method (Phase 2 chat-submit gating)", () => {
    it("dispatches a ui/notifications/chat-flush postMessage at the proxy origin", () => {
      const ref = createRef<LedPlanckLabFrameHandle>();
      render(
        <LedPlanckLabFrame
          ref={ref}
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
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
    render(
      <LedPlanckLabFrame
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
              kind: "led-planck.measurement",
              data: { led: "red", u0: 1.99, lambda: 625, h_computed: 6.6e-34 },
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
