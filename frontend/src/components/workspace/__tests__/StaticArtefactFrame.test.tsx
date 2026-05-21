// Tests for StaticArtefactFrame — the spec-compliant host wrapper for
// MCP-App static artefacts. The contract these tests pin:
//
//   1. Mounts iframe at ${sandboxOrigin}/sandbox.html with the right
//      sandbox attributes (allow-scripts + allow-same-origin on the
//      outer proxy frame, per spec §Sandbox proxy line 475).
//   2. On ui/notifications/sandbox-proxy-ready: fetches the artefact
//      HTML and sends ui/notifications/sandbox-resource-ready back
//      with {html, sandbox}.
//   3. Responds to artefact's ui/initialize with a McpUiInitializeResult
//      containing hostContext.
//   4. Forwards ui/update-model-context notifications to onUpdateModelContext.
//   5. Calls onInitialized when ui/notifications/initialized arrives.
//   6. Responds to ping requests with result: {}.
//   7. Rejects messages whose origin doesn't match sandboxOrigin.

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaticArtefactFrame } from "../StaticArtefactFrame";

const SANDBOX_ORIGIN = "http://localhost:3457";

// We hook the iframe's contentWindow.postMessage so tests can observe
// what the host sends to the proxy. jsdom gives us a real Window for
// the iframe, so we can spy on its postMessage directly.
function captureProxyPostMessage() {
  const captured: { msg: unknown; targetOrigin: string }[] = [];
  // Find the iframe AFTER it mounts; the captures are registered then.
  const setup = () => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement | null;
    if (!iframe?.contentWindow) return false;
    const orig = iframe.contentWindow.postMessage.bind(iframe.contentWindow);
    iframe.contentWindow.postMessage = ((msg: unknown, target: string | StructuredSerializeOptions) => {
      captured.push({
        msg,
        targetOrigin: typeof target === "string" ? target : "(opts)",
      });
      // Don't actually dispatch — the proxy isn't running in jsdom anyway.
      return orig as unknown as ReturnType<typeof Window.prototype.postMessage>;
    }) as typeof window.postMessage;
    return true;
  };
  return { captured, setup };
}

// Helper to dispatch a synthetic event "from the proxy" (origin == SANDBOX_ORIGIN).
function dispatchFromProxy(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data, origin: SANDBOX_ORIGIN }));
}

describe("StaticArtefactFrame", () => {
  // Mock global fetch for the artefact HTML lookup. Tests that need a
  // specific response override per-test.
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response("<!doctype html><html><body>art</body></html>", { status: 200 })),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders the iframe at ${sandboxOrigin}/sandbox.html with allow-scripts allow-same-origin", () => {
    render(
      <StaticArtefactFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        artefactPath="boldkast/v1"
        onUpdateModelContext={() => {}}
      />,
    );
    const iframe = screen.getByTitle(/MCP App artefact/i) as HTMLIFrameElement;
    expect(iframe.src).toBe(`${SANDBOX_ORIGIN}/sandbox.html`);
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
  });

  it("strips trailing slash on sandboxOrigin", () => {
    render(
      <StaticArtefactFrame
        sandboxOrigin={`${SANDBOX_ORIGIN}/`}
        artefactPath="boldkast/v1"
        onUpdateModelContext={() => {}}
      />,
    );
    const iframe = screen.getByTitle(/MCP App artefact/i) as HTMLIFrameElement;
    expect(iframe.src).toBe(`${SANDBOX_ORIGIN}/sandbox.html`);
  });

  it("rejects messages from origins other than sandboxOrigin", () => {
    const onUpdateModelContext = vi.fn();
    render(
      <StaticArtefactFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        artefactPath="boldkast/v1"
        onUpdateModelContext={onUpdateModelContext}
      />,
    );
    // Even with a valid envelope, wrong origin → reject.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          jsonrpc: "2.0",
          method: "ui/update-model-context",
          params: { structuredContent: { v: 1 } },
        },
        origin: "https://evil.example.com",
      }),
    );
    expect(onUpdateModelContext).not.toHaveBeenCalled();
  });

  it("forwards ui/update-model-context notifications to onUpdateModelContext (the main path)", () => {
    const onUpdateModelContext = vi.fn();
    render(
      <StaticArtefactFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        artefactPath="boldkast/v1"
        onUpdateModelContext={onUpdateModelContext}
      />,
    );
    dispatchFromProxy({
      jsonrpc: "2.0",
      method: "ui/update-model-context",
      params: { structuredContent: { kind: "boldkast.show_value", marker: "y_max" } },
    });
    expect(onUpdateModelContext).toHaveBeenCalledTimes(1);
    expect(onUpdateModelContext.mock.calls[0][0]).toEqual({
      kind: "boldkast.show_value",
      marker: "y_max",
    });
  });

  it("ignores ui/update-model-context with no structuredContent (spec allows content-only; we currently only consume structuredContent)", () => {
    const onUpdateModelContext = vi.fn();
    render(
      <StaticArtefactFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        artefactPath="boldkast/v1"
        onUpdateModelContext={onUpdateModelContext}
      />,
    );
    dispatchFromProxy({
      jsonrpc: "2.0",
      method: "ui/update-model-context",
      params: { content: [{ type: "text", text: "hi" }] }, // no structuredContent
    });
    expect(onUpdateModelContext).not.toHaveBeenCalled();
  });

  it("calls onInitialized when artefact sends ui/notifications/initialized", () => {
    const onInitialized = vi.fn();
    render(
      <StaticArtefactFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        artefactPath="boldkast/v1"
        onUpdateModelContext={() => {}}
        onInitialized={onInitialized}
      />,
    );
    dispatchFromProxy({
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
      params: { clientInfo: { name: "boldkast", version: "1.0.0" } },
    });
    expect(onInitialized).toHaveBeenCalledWith({ name: "boldkast", version: "1.0.0" });
  });

  it("fetches artefact HTML and sends sandbox-resource-ready when proxy says it's ready", async () => {
    const cap = captureProxyPostMessage();
    render(
      <StaticArtefactFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        artefactPath="boldkast/v1"
        onUpdateModelContext={() => {}}
      />,
    );
    // Allow React to mount the iframe + the capture-spy to hook the
    // contentWindow.postMessage. captureProxyPostMessage spies AFTER mount.
    await waitFor(() => expect(cap.setup()).toBe(true));

    dispatchFromProxy({
      jsonrpc: "2.0",
      method: "ui/notifications/sandbox-proxy-ready",
      params: {},
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`${SANDBOX_ORIGIN}/artefacts/boldkast/v1/index.html`);
    });
    await waitFor(() => {
      const resourceReady = cap.captured.find(
        (m) =>
          typeof m.msg === "object" &&
          m.msg !== null &&
          (m.msg as { method?: string }).method === "ui/notifications/sandbox-resource-ready",
      );
      expect(resourceReady).toBeDefined();
      const params = (resourceReady?.msg as { params?: { html?: string; sandbox?: string } })?.params;
      expect(params?.html).toContain("<!doctype html>");
      expect(params?.sandbox).toContain("allow-scripts");
    });
  });

  it("responds to ui/initialize with hostContext (handshake completion)", async () => {
    const cap = captureProxyPostMessage();
    render(
      <StaticArtefactFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        artefactPath="boldkast/v1"
        onUpdateModelContext={() => {}}
        hostContext={{ theme: "dark", locale: "da-DK" }}
      />,
    );
    await waitFor(() => expect(cap.setup()).toBe(true));

    dispatchFromProxy({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
      params: {
        protocolVersion: "2026-01-26",
        capabilities: {},
        clientInfo: { name: "boldkast", version: "1.0.0" },
      },
    });

    await waitFor(() => {
      const response = cap.captured.find(
        (m) => typeof m.msg === "object" && m.msg !== null && (m.msg as { id?: number }).id === 1,
      );
      expect(response).toBeDefined();
      const result = (response?.msg as { result?: { hostContext?: Record<string, unknown> } })
        ?.result;
      expect(result?.hostContext).toMatchObject({
        theme: "dark",
        locale: "da-DK",
        displayMode: "inline",
      });
    });
  });

  it("responds to ping requests with result: {} (spec line 508)", async () => {
    const cap = captureProxyPostMessage();
    render(
      <StaticArtefactFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        artefactPath="boldkast/v1"
        onUpdateModelContext={() => {}}
      />,
    );
    await waitFor(() => expect(cap.setup()).toBe(true));

    dispatchFromProxy({ jsonrpc: "2.0", id: 42, method: "ping" });

    await waitFor(() => {
      const response = cap.captured.find(
        (m) => typeof m.msg === "object" && m.msg !== null && (m.msg as { id?: number }).id === 42,
      );
      expect(response).toBeDefined();
      expect((response?.msg as { result?: unknown }).result).toEqual({});
    });
  });

  it("ignores messages without jsonrpc: 2.0 envelope (defense against non-spec senders)", () => {
    const onUpdateModelContext = vi.fn();
    render(
      <StaticArtefactFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        artefactPath="boldkast/v1"
        onUpdateModelContext={onUpdateModelContext}
      />,
    );
    // Same origin, valid method, no jsonrpc field → rejected
    dispatchFromProxy({ method: "ui/update-model-context", params: { structuredContent: {} } });
    // Same origin, valid method, wrong jsonrpc version → rejected
    dispatchFromProxy({
      jsonrpc: "1.0",
      method: "ui/update-model-context",
      params: { structuredContent: {} },
    });
    expect(onUpdateModelContext).not.toHaveBeenCalled();
  });
});
