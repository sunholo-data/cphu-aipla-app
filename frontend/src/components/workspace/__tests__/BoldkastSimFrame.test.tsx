import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BoldkastSimFrame,
  type BoldkastSimFrameHandle,
} from "../BoldkastSimFrame";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));
import { fetchWithAuth } from "@/lib/apiClient";

const dispatchMock = vi.fn();
vi.mock("@/hooks/useHumanToolEvents", () => ({
  useHumanToolEvents: () => ({ events: [], dispatch: dispatchMock, clear: vi.fn() }),
}));

// Mock global fetch (StaticArtefactFrame fetches artefact HTML on the
// sandbox-proxy-ready signal). Tests that exercise the proxy handshake
// override this; tests that only dispatch ui/update-model-context
// notifications don't care.
const originalFetch = global.fetch;

const SANDBOX_ORIGIN = "https://aipla-v01-sandbox-test.run.app";

// Dispatch a JSON-RPC ui/update-model-context notification "from" the
// sandbox proxy. structuredContent carries the artefact's event vocab
// in the `kind` field.
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

describe("BoldkastSimFrame", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockClear();
    dispatchMock.mockClear();
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response("<!doctype html><html><body>art</body></html>", { status: 200 })),
    ) as unknown as typeof fetch;
  });

  it("renders the StaticArtefactFrame iframe pointing at /sandbox.html", () => {
    render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId={null} onClose={() => {}} />);
    const iframe = screen.getByTitle(/Boldkast.*simulator/i) as HTMLIFrameElement;
    expect(iframe.src).toBe(`${SANDBOX_ORIGIN}/sandbox.html`);
  });

  it("outer iframe has spec-compliant sandbox attrs (allow-scripts + allow-same-origin)", () => {
    render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId={null} onClose={() => {}} />);
    const iframe = screen.getByTitle(/Boldkast.*simulator/i);
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
  });

  it("close button fires onClose", () => {
    const onClose = vi.fn();
    render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId={null} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/Luk simulator/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("human-tool-use card dispatch", () => {
    it("dispatches 'Afslørede y_max' on marker reveal (ui/update-model-context)", () => {
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      dispatchUpdateModelContext({
        kind: "boldkast.show_value",
        marker: "y_max",
        revealed: true,
      });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe("Afslørede y_max");
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    });

    it("does not dispatch on re-reveal of an already-revealed marker", () => {
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      dispatchUpdateModelContext({ kind: "boldkast.show_value", marker: "y_max", revealed: true });
      dispatchUpdateModelContext({ kind: "boldkast.show_value", marker: "y_max", revealed: true });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
    });

    it("does not dispatch on un-reveal (intentional silence)", () => {
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      dispatchUpdateModelContext({ kind: "boldkast.show_value", marker: "y_max", revealed: true });
      dispatchMock.mockClear();
      dispatchUpdateModelContext({ kind: "boldkast.show_value", marker: "y_max", revealed: false });
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("Phase 2: state-change with triggeredBy=play dispatches an Afspillede card with all changed params", () => {
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      dispatchUpdateModelContext({
        kind: "boldkast.state-change",
        changed: ["v0", "theta"],
        state: { v0: 25, theta: 40, g: 9.82 },
        triggeredBy: "play",
      });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe(
        "Afspillede med v₀=25 m/s, θ=40°",
      );
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    });

    it("Phase 2: state-change with triggeredBy=chat-submit dispatches a Sendte spørgsmål card", () => {
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      dispatchUpdateModelContext({
        kind: "boldkast.state-change",
        changed: ["g"],
        state: { v0: 10, theta: 30, g: 1.62 },
        triggeredBy: "chat-submit",
      });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe(
        "Sendte spørgsmål med g=1.62 m/s²",
      );
    });

    it("Phase 2: legacy boldkast.param.change events are ignored (no card, no push)", () => {
      // M1 dropped the param.change kind. A stale artefact still
      // emitting it should be silently ignored — no card, no fetch,
      // no exception. This guards against rollout skew where the
      // host updates ahead of the artefact deploy.
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      dispatchUpdateModelContext({
        kind: "boldkast.param.change",
        param: "v0",
        value: 25,
      });
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(fetchWithAuth).not.toHaveBeenCalled();
    });

    it("pushes but does not dispatch on boldkast.open (not a pedagogical action)", () => {
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      dispatchUpdateModelContext({ kind: "boldkast.open" });
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("does not push (and no card) when sessionId is null", () => {
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId={null} onClose={() => {}} />);
      dispatchUpdateModelContext({ kind: "boldkast.show_value", marker: "y_max", revealed: true });
      expect(fetchWithAuth).not.toHaveBeenCalled();
      expect(dispatchMock).not.toHaveBeenCalled();
    });
  });

  describe("sendChatFlush ref method (Phase 2 chat-submit gating)", () => {
    it("dispatches a ui/notifications/chat-flush postMessage at the proxy origin", () => {
      const ref = createRef<BoldkastSimFrameHandle>();
      render(
        <BoldkastSimFrame
          ref={ref}
          sandboxOrigin={SANDBOX_ORIGIN}
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );

      // Capture postMessage calls on the proxy iframe's contentWindow.
      // StaticArtefactFrame.sendNotification posts directly via the
      // iframe's contentWindow.postMessage; spy on the first iframe.
      const iframe = screen.getByTitle(/Boldkast.*simulator/i) as HTMLIFrameElement;
      const postSpy = vi.fn();
      // jsdom iframe contentWindow exists but is read-only on
      // HTMLIFrameElement — use Object.defineProperty to replace it.
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
          sessionId="sess-1"
          onClose={() => {}}
        />,
      );
      const iframe = screen.getByTitle(/Boldkast.*simulator/i) as HTMLIFrameElement;
      Object.defineProperty(iframe, "contentWindow", {
        configurable: true,
        value: null,
      });
      // No exception; no-op.
      expect(() => ref.current!.sendChatFlush()).not.toThrow();
    });
  });

  it("rejects messages from origins other than sandboxOrigin (origin-based auth)", () => {
    render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
    // Same JSON-RPC envelope, wrong origin → rejected by StaticArtefactFrame
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          jsonrpc: "2.0",
          method: "ui/update-model-context",
          params: { structuredContent: { kind: "boldkast.show_value", marker: "y_max", revealed: true } },
        },
        origin: "https://evil.example.com",
      }),
    );
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  // Reset global.fetch in afterAll to be clean — though afterEach in
  // beforeEach already re-assigns per test.
  it("teardown — restore fetch", () => {
    global.fetch = originalFetch;
    expect(true).toBe(true);
  });
});
