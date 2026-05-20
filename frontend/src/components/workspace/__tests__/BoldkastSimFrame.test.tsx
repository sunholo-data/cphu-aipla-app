import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoldkastSimFrame } from "../BoldkastSimFrame";

const ORIGIN = "https://aipla-v01-sandbox-test.run.app";

describe("BoldkastSimFrame", () => {
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
