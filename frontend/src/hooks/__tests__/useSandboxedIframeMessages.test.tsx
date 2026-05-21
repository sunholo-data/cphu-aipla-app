// Tests for the shared sandboxed-iframe message-listener hook.
// See: docs/design/aipla/v0.1.0-jutland/mcp-app-iframe-harness.md

import { render } from "@testing-library/react";
import { useRef, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type SandboxedIframeMessage,
  useSandboxedIframeMessages,
} from "../useSandboxedIframeMessages";

interface MyMsg extends SandboxedIframeMessage {
  type: string;
  payload?: number;
}

interface HarnessProps {
  onMessage: (data: MyMsg) => void;
  sourceMarker?: string;
  exposeIframe?: (el: HTMLIFrameElement | null) => void;
}

function Harness({ onMessage, sourceMarker = "test-art", exposeIframe }: HarnessProps) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    if (exposeIframe) exposeIframe(ref.current);
  });
  useSandboxedIframeMessages<MyMsg>({
    iframeRef: ref,
    sourceMarker,
    onMessage,
  });
  return <iframe ref={ref} sandbox="allow-scripts" title="harness" />;
}

function dispatchTo(source: Window | null, data: unknown, origin = "null") {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

describe("useSandboxedIframeMessages", () => {
  let exposedIframe: HTMLIFrameElement | null = null;
  const captureIframe = (el: HTMLIFrameElement | null) => {
    exposedIframe = el;
  };

  beforeEach(() => {
    exposedIframe = null;
  });
  afterEach(() => {
    // No global state to clean — render cleanup handles listener removal
    // via the hook's useEffect return.
  });

  it("calls onMessage when e.source matches the iframe AND data shape is valid", () => {
    const onMessage = vi.fn();
    render(<Harness onMessage={onMessage} exposeIframe={captureIframe} />);
    expect(exposedIframe).not.toBeNull();
    dispatchTo(exposedIframe!.contentWindow, {
      source: "test-art",
      type: "art.event",
      payload: 42,
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0]).toMatchObject({ type: "art.event", payload: 42 });
  });

  it("rejects events whose e.source is NOT our iframe (window-identity auth)", () => {
    const onMessage = vi.fn();
    render(<Harness onMessage={onMessage} exposeIframe={captureIframe} />);
    // Pretend the message came from window itself, not the iframe.
    dispatchTo(window, { source: "test-art", type: "art.event" });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects events whose e.source is null", () => {
    const onMessage = vi.fn();
    render(<Harness onMessage={onMessage} exposeIframe={captureIframe} />);
    dispatchTo(null, { source: "test-art", type: "art.event" });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects events whose data.source marker doesn't match (coexisting artefacts)", () => {
    const onMessage = vi.fn();
    render(
      <Harness onMessage={onMessage} sourceMarker="test-art" exposeIframe={captureIframe} />,
    );
    dispatchTo(exposedIframe!.contentWindow, {
      source: "other-art",
      type: "art.event",
    });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects events whose data.type is not a string", () => {
    const onMessage = vi.fn();
    render(<Harness onMessage={onMessage} exposeIframe={captureIframe} />);
    dispatchTo(exposedIframe!.contentWindow, { source: "test-art", type: 42 });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects events whose data is null or non-object", () => {
    const onMessage = vi.fn();
    render(<Harness onMessage={onMessage} exposeIframe={captureIframe} />);
    dispatchTo(exposedIframe!.contentWindow, null);
    dispatchTo(exposedIframe!.contentWindow, "string-data");
    dispatchTo(exposedIframe!.contentWindow, 42);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("removes the listener on unmount", () => {
    const onMessage = vi.fn();
    const { unmount } = render(<Harness onMessage={onMessage} exposeIframe={captureIframe} />);
    const iframeWindow = exposedIframe!.contentWindow;
    unmount();
    // Dispatch after unmount — should NOT fire onMessage
    dispatchTo(iframeWindow, { source: "test-art", type: "art.event" });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("dev-mode: console.logs every accepted event under sourceMarker label", () => {
    const onMessage = vi.fn();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    render(<Harness onMessage={onMessage} exposeIframe={captureIframe} />);
    dispatchTo(exposedIframe!.contentWindow, { source: "test-art", type: "art.event" });
    expect(consoleSpy).toHaveBeenCalledWith(
      "[test-art]",
      expect.objectContaining({ type: "art.event" }),
    );
    consoleSpy.mockRestore();
  });

  it("does not call onMessage for a rejected event (no console log either)", () => {
    const onMessage = vi.fn();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    render(<Harness onMessage={onMessage} exposeIframe={captureIframe} />);
    // Wrong source marker
    dispatchTo(exposedIframe!.contentWindow, { source: "other-art", type: "art.event" });
    expect(onMessage).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
