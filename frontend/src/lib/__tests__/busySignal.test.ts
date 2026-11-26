import { afterEach, describe, expect, it, vi } from "vitest";

const reportClientError = vi.fn();
vi.mock("@/lib/clientErrorReporting", () => ({ reportClientError: (...a: unknown[]) => reportClientError(...a) }));

import { noteBusyResponse, onBusy, reportBusy } from "../busySignal";

afterEach(() => reportClientError.mockClear());

describe("busySignal (2026-11-26)", () => {
  it("a 503 marked busy by the backend raises the signal and a 'busy' beacon", () => {
    const seen: number[] = [];
    const off = onBusy((at) => seen.push(at));
    noteBusyResponse(new Response(null, { status: 503, headers: { "X-AIPLA-Busy": "1" } }));
    expect(seen).toHaveLength(1);
    expect(reportClientError).toHaveBeenCalledWith({ kind: "busy", message: "busy: request" });
    off();
  });

  it("an ordinary 503, 500 or 200 raises nothing", () => {
    const seen: number[] = [];
    const off = onBusy((at) => seen.push(at));
    noteBusyResponse(new Response(null, { status: 503 }));
    noteBusyResponse(new Response(null, { status: 500, headers: { "X-AIPLA-Busy": "1" } }));
    noteBusyResponse(new Response(null, { status: 200 }));
    expect(seen).toHaveLength(0);
    off();
  });

  it("returns the response unchanged, so callers read it as before", () => {
    const resp = new Response("{}", { status: 503, headers: { "X-AIPLA-Busy": "1" } });
    expect(noteBusyResponse(resp)).toBe(resp);
  });

  it("onBusy unsubscribes", () => {
    const seen: number[] = [];
    onBusy((at) => seen.push(at))();
    reportBusy("chat");
    expect(seen).toHaveLength(0);
  });
});
