import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoldkastSimFrame } from "../BoldkastSimFrame";

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
// in the `kind` field — same shape Boldkast now emits per M3.
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
    // allow-same-origin is required on the OUTER sandbox-proxy frame
    // per MCP Apps spec §Sandbox proxy line 475 — proxy needs it to
    // bridge the inner artefact iframe. The inner artefact frame
    // continues to run under stricter sandbox attrs set by sandbox.ts.
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

    it("dispatches 'Skiftede tyngdekraft til Månen' on Moon preset", () => {
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      dispatchUpdateModelContext({
        kind: "boldkast.param.change",
        param: "g",
        value: 1.62,
        triggeredBy: "preset:moon",
      });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe("Skiftede tyngdekraft til Månen");
    });

    it("does not dispatch a card on slider-drag (no triggeredBy)", () => {
      vi.useFakeTimers();
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      dispatchUpdateModelContext({ kind: "boldkast.param.change", param: "v0", value: 20 });
      // No card immediately — debounce is pending
      expect(dispatchMock).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("debounces slider drags and pushes the final value with a card after 500ms", () => {
      vi.useFakeTimers();
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      // Three rapid drag events — only the LAST should produce a push.
      dispatchUpdateModelContext({ kind: "boldkast.param.change", param: "v0", value: 10 });
      dispatchUpdateModelContext({ kind: "boldkast.param.change", param: "v0", value: 12 });
      dispatchUpdateModelContext({ kind: "boldkast.param.change", param: "v0", value: 15 });
      expect(fetchWithAuth).not.toHaveBeenCalled();
      expect(dispatchMock).not.toHaveBeenCalled();
      vi.advanceTimersByTime(499);
      expect(fetchWithAuth).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2);
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
      const body = JSON.parse(
        (vi.mocked(fetchWithAuth).mock.calls[0][1]?.body as string) ?? "{}",
      );
      expect(body.structuredContent.v0).toBe(15);
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe("Justerede v₀ til 15 m/s");
      vi.useRealTimers();
    });

    it("uses θ label for theta slider end", () => {
      vi.useFakeTimers();
      render(<BoldkastSimFrame sandboxOrigin={SANDBOX_ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      dispatchUpdateModelContext({ kind: "boldkast.param.change", param: "theta", value: 40 });
      vi.advanceTimersByTime(501);
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe("Justerede θ til 40°");
      vi.useRealTimers();
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
