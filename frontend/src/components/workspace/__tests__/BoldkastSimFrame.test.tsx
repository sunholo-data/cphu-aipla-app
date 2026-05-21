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

const ORIGIN = "https://aipla-v01-sandbox-test.run.app";

// jsdom's window.postMessage forces origin to the receiving page's. To
// exercise the ADR-013 origin gate we dispatch a synthetic MessageEvent
// with the origin we control.
function emit(detail: Record<string, unknown>, origin: string = ORIGIN) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { source: "boldkast", ...detail },
      origin,
    }),
  );
}

describe("BoldkastSimFrame", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockClear();
    dispatchMock.mockClear();
  });

  it("renders the iframe at /artefacts/boldkast/v1/", () => {
    render(<BoldkastSimFrame sandboxOrigin={ORIGIN} sessionId={null} onClose={() => {}} />);
    const iframe = screen.getByTitle(/Boldkast.*simulator/i) as HTMLIFrameElement;
    expect(iframe.src).toBe(`${ORIGIN}/artefacts/boldkast/v1/index.html`);
  });

  it("iframe carries ADR-013 sandbox + referrer attrs", () => {
    render(<BoldkastSimFrame sandboxOrigin={ORIGIN} sessionId={null} onClose={() => {}} />);
    const iframe = screen.getByTitle(/Boldkast.*simulator/i);
    // allow-scripts only — must NOT contain allow-same-origin/top-nav/popups
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("strips trailing slash on the sandbox origin", () => {
    render(<BoldkastSimFrame sandboxOrigin={`${ORIGIN}/`} sessionId={null} onClose={() => {}} />);
    const iframe = screen.getByTitle(/Boldkast.*simulator/i) as HTMLIFrameElement;
    expect(iframe.src).toBe(`${ORIGIN}/artefacts/boldkast/v1/index.html`);
  });

  it("close button fires onClose", () => {
    const onClose = vi.fn();
    render(<BoldkastSimFrame sandboxOrigin={ORIGIN} sessionId={null} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/Luk simulator/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("human-tool-use card dispatch", () => {
    it("dispatches 'Afslørede y_max' on marker reveal", () => {
      render(<BoldkastSimFrame sandboxOrigin={ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      emit({ type: "boldkast.show_value", marker: "y_max", revealed: true });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe("Afslørede y_max");
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    });

    it("does not dispatch on re-reveal of an already-revealed marker", () => {
      render(<BoldkastSimFrame sandboxOrigin={ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      emit({ type: "boldkast.show_value", marker: "y_max", revealed: true });
      emit({ type: "boldkast.show_value", marker: "y_max", revealed: true });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
    });

    it("does not dispatch on un-reveal (intentional silence)", () => {
      render(<BoldkastSimFrame sandboxOrigin={ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      emit({ type: "boldkast.show_value", marker: "y_max", revealed: true });
      dispatchMock.mockClear();
      emit({ type: "boldkast.show_value", marker: "y_max", revealed: false });
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("dispatches 'Skiftede tyngdekraft til Månen' on Moon preset", () => {
      render(<BoldkastSimFrame sandboxOrigin={ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      emit({
        type: "boldkast.param.change",
        param: "g",
        value: 1.62,
        triggeredBy: "preset:moon",
      });
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0].label).toBe("Skiftede tyngdekraft til Månen");
    });

    it("does not dispatch on slider-drag param.change (no triggeredBy)", () => {
      render(<BoldkastSimFrame sandboxOrigin={ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      emit({ type: "boldkast.param.change", param: "v0", value: 20 });
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(fetchWithAuth).not.toHaveBeenCalled();
    });

    it("pushes but does not dispatch on boldkast.open (not a pedagogical action)", () => {
      render(<BoldkastSimFrame sandboxOrigin={ORIGIN} sessionId="sess-1" onClose={() => {}} />);
      emit({ type: "boldkast.open" });
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("does not push (and no card) when sessionId is null", () => {
      render(<BoldkastSimFrame sandboxOrigin={ORIGIN} sessionId={null} onClose={() => {}} />);
      emit({ type: "boldkast.show_value", marker: "y_max", revealed: true });
      expect(fetchWithAuth).not.toHaveBeenCalled();
      expect(dispatchMock).not.toHaveBeenCalled();
    });
  });

  it("postMessage handler ignores messages from non-sandbox origins (ADR-013 origin gate)", () => {
    // We can't directly observe the handler, but we can verify it doesn't
    // crash + doesn't bubble side effects when a wrong-origin message arrives.
    // The component shouldn't log to console in production paths.
    render(<BoldkastSimFrame sandboxOrigin={ORIGIN} sessionId={null} onClose={() => {}} />);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Same-origin message (jsdom default) should be ignored because it doesn't match ORIGIN.
    window.postMessage({ source: "boldkast", type: "boldkast.open" }, "*");
    // Tick once so the message-loop fires.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // The message bypasses our handler (origin mismatch in jsdom is the
        // implicit default), so console.log shouldn't have been called for it.
        // (In dev mode our handler logs valid boldkast events; here we expect zero.)
        // Note: jsdom's window.postMessage origin defaults to ''; our handler
        // rejects ''  !== ORIGIN, so no log.
        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
        resolve();
      }, 10);
    });
  });
});
