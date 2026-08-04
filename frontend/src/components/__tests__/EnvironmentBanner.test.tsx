import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnvironmentBanner } from "@/components/EnvironmentBanner";
import { resetEnvironmentCache } from "@/lib/environment";

/**
 * The banner exists because AIPLA's three deployments are indistinguishable
 * from their URLs: on 2026-08-04 a teacher minted group codes on dev and typed
 * them into test for two hours, 401ing on every join. These tests pin the two
 * behaviours that make it worth having — it names non-prod loudly, and it never
 * implies "you're on the live site" when it doesn't actually know.
 */

function mockEnvironmentResponse(
  body: unknown,
  { ok = true }: { ok?: boolean } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) })),
  );
}

describe("EnvironmentBanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetEnvironmentCache();
  });

  it("names the test environment", async () => {
    mockEnvironmentResponse({
      env: "test",
      projectId: "aipla-test-2026",
      version: "v0.1.5",
    });

    render(<EnvironmentBanner />);

    const banner = await screen.findByTestId("environment-banner");
    expect(banner).toHaveAttribute("data-environment", "test");
    expect(banner).toHaveTextContent("TEST");
    // The actionable half: codes are scoped to this address.
    expect(banner).toHaveTextContent(/work only on this address/i);
    expect(banner).toHaveTextContent("aipla-test-2026");
  });

  it("names the dev environment", async () => {
    mockEnvironmentResponse({ env: "dev", projectId: "aipla-dev-2026", version: null });

    render(<EnvironmentBanner />);

    const banner = await screen.findByTestId("environment-banner");
    expect(banner).toHaveAttribute("data-environment", "dev");
    expect(banner).toHaveTextContent("DEV");
  });

  it("stays silent on prod — the real site needs no warning strip", async () => {
    mockEnvironmentResponse({ env: "prod", projectId: "aipla-prod-2026", version: "v0.1.5" });

    const { container } = render(<EnvironmentBanner />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("stays silent in LOCAL_MODE — LocalModeBanner already says it", async () => {
    mockEnvironmentResponse({ env: "local", projectId: null, version: null });

    const { container } = render(<EnvironmentBanner />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("flags an unrecognised deployment rather than assuming it is prod", async () => {
    mockEnvironmentResponse({ env: "something-else", projectId: "other", version: null });

    render(<EnvironmentBanner />);

    const banner = await screen.findByTestId("environment-banner");
    expect(banner).toHaveAttribute("data-environment", "unknown");
    expect(banner).toHaveTextContent(/UNKNOWN/i);
  });

  it("renders nothing when the backend cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));

    const { container } = render(<EnvironmentBanner />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on a non-200 rather than guessing", async () => {
    mockEnvironmentResponse({}, { ok: false });

    const { container } = render(<EnvironmentBanner />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
