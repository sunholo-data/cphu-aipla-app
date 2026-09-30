/**
 * 1.1.96 M-1 — the window-level error listeners, and the two Next boundaries.
 *
 * The three sources catch disjoint sets, so each is tested separately: React
 * swallows a render throw into a boundary and `window.onerror` never fires for
 * it, while the boundaries never see a rejected promise. Any one alone leaves a
 * hole, and only per-source tests would notice if one were dropped.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalErrorReporter } from "@/components/GlobalErrorReporter";

const reportClientError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clientErrorReporting", () => ({ reportClientError }));
const stopEnvBeacon = vi.hoisted(() => vi.fn());
const startClientEnvBeacon = vi.hoisted(() => vi.fn(() => stopEnvBeacon));
vi.mock("@/lib/clientEnvBeacon", () => ({ startClientEnvBeacon }));

// Imported after the mock so the boundaries pick it up.
const RouteError = (await import("@/app/error")).default;
const GlobalError = (await import("@/app/global-error")).default;

describe("GlobalErrorReporter", () => {
  beforeEach(() => {
    reportClientError.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a window error event", () => {
    render(<GlobalErrorReporter />);
    const err = new Error("kaboom");
    window.dispatchEvent(new ErrorEvent("error", { message: "kaboom", error: err }));
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "window.onerror", message: "kaboom" }),
    );
  });

  it("falls back to event.message for a cross-origin 'Script error.'", () => {
    render(<GlobalErrorReporter />);
    // No `error` property — all the browser gives us for a cross-origin script.
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "window.onerror", message: "Script error." }),
    );
  });

  it("reports an unhandled promise rejection", () => {
    render(<GlobalErrorReporter />);
    const event = new Event("unhandledrejection") as Event & { reason: unknown };
    event.reason = new Error("fetch failed");
    window.dispatchEvent(event);
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "unhandledrejection", message: "fetch failed" }),
    );
  });

  it("stringifies a non-Error rejection reason rather than dropping it", () => {
    render(<GlobalErrorReporter />);
    const event = new Event("unhandledrejection") as Event & { reason: unknown };
    event.reason = "just a string";
    window.dispatchEvent(event);
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "unhandledrejection", message: "just a string" }),
    );
  });

  it("removes both listeners on unmount — no leak across route changes", () => {
    const { unmount } = render(<GlobalErrorReporter />);
    unmount();
    window.dispatchEvent(new ErrorEvent("error", { message: "after unmount" }));
    const event = new Event("unhandledrejection") as Event & { reason: unknown };
    event.reason = new Error("after unmount");
    window.dispatchEvent(event);
    expect(reportClientError).not.toHaveBeenCalled();
  });

  it("renders nothing", () => {
    const { container } = render(<GlobalErrorReporter />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("app/error.tsx — the route boundary", () => {
  beforeEach(() => {
    reportClientError.mockClear();
  });

  it("reports the render error exactly once", () => {
    const error = Object.assign(new Error("render blew up"), { digest: "abc123" });
    render(<RouteError error={error} reset={() => {}} />);
    expect(reportClientError).toHaveBeenCalledOnce();
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "render", message: "render blew up" }),
    );
  });

  it("gives the person a way out, not just an apology", () => {
    const reset = vi.fn();
    const assign = vi.fn();
    // jsdom's location.assign is not implemented; replace it wholesale.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign },
    });

    render(<RouteError error={new Error("boom")} reset={reset} />);
    screen.getByRole("button", { name: /try again/i }).click();
    expect(reset).toHaveBeenCalledOnce();

    // A hard navigation, not a soft <Link>: client-side routing is what failed.
    screen.getByRole("button", { name: /start page/i }).click();
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("shows the digest so a screenshot ties back to a log line", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    render(<RouteError error={error} reset={() => {}} />);
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });
});

describe("1.1.138 M0 — a stale-deploy reload, and whether it worked", () => {
  const PENDING = "aipla:stale-deploy-reload-pending";
  const staleError = () => new TypeError("Cannot read properties of undefined (reading 'call')");

  beforeEach(() => {
    reportClientError.mockClear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function markReloaded(fromBuildId: string | null = "b-old") {
    window.sessionStorage.setItem(PENDING, JSON.stringify({ at: Date.now(), fromBuildId }));
  }

  it("the reloaded page reports `recovered` once it has rendered for a moment", () => {
    vi.useFakeTimers();
    markReloaded("b-old");
    render(<GlobalErrorReporter />);
    expect(reportClientError).not.toHaveBeenCalled(); // not on mount — a boundary may still claim it
    vi.advanceTimersByTime(3_000);
    expect(reportClientError).toHaveBeenCalledOnce();
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "recovered", afterAutoReload: true, previousBuildId: "b-old" }),
    );
  });

  it("an ordinary page load reports nothing", () => {
    vi.useFakeTimers();
    render(<GlobalErrorReporter />);
    vi.advanceTimersByTime(10_000);
    expect(reportClientError).not.toHaveBeenCalled();
  });

  it("a crash on the reloaded page is flagged afterAutoReload and is NOT also a recovery", () => {
    vi.useFakeTimers();
    markReloaded();
    render(<GlobalErrorReporter />);
    render(<RouteError error={new Error("still broken")} reset={() => {}} />);
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "render", afterAutoReload: true, autoReloaded: false }),
    );
    vi.advanceTimersByTime(3_000);
    expect(reportClientError).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "recovered" }));
  });

  it("the route boundary says when its crash started a reload", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    render(<RouteError error={staleError()} reset={() => {}} />);
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "render", autoReloaded: true, afterAutoReload: false }),
    );
    expect(reload).toHaveBeenCalledOnce();
  });

  it("the window listener says when a chunk-load failure started a reload", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    render(<GlobalErrorReporter />);
    const event = new Event("unhandledrejection") as Event & { reason: unknown };
    event.reason = new Error("Loading chunk 1255 failed.");
    window.dispatchEvent(event);
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "unhandledrejection", autoReloaded: true }),
    );
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("app/global-error.tsx — the root-layout boundary", () => {
  beforeEach(() => {
    reportClientError.mockClear();
  });

  it("reports the root-layout error", () => {
    // It renders its own <html>/<body> — that is the point of this boundary,
    // since Next replaces the whole document. React logs a nesting complaint
    // about <html> inside the test container; expected, and silenced so a real
    // error in this suite still stands out.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<GlobalError error={new Error("layout blew up")} reset={() => {}} />, {
      container: document.createElement("div"),
    });
    consoleError.mockRestore();
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "render", message: "layout blew up" }),
    );
  });
});

describe("GlobalErrorReporter — screen-size beacon (2026-09-30)", () => {
  it("starts the environment beacon on mount and stops it on unmount", () => {
    startClientEnvBeacon.mockClear();
    stopEnvBeacon.mockClear();
    const { unmount } = render(<GlobalErrorReporter />);
    expect(startClientEnvBeacon).toHaveBeenCalledTimes(1);
    unmount();
    expect(stopEnvBeacon).toHaveBeenCalledTimes(1);
  });
});
