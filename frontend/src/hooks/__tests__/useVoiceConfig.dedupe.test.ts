/**
 * One request per config, however many message bubbles ask.
 *
 * `MessageBubble` calls this hook once PER MESSAGE. Prod, 2026-09-22..24:
 * ~11,600 GET /api/voice/config in four days, ~4,000 in one lesson hour, at
 * ~80 ms spacing — every bubble fetched on mount, every bubble refetched on
 * every tab focus, and after a 401 (nothing cached) every newly mounted bubble
 * fetched again.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetVoiceConfigCacheForTests, useVoiceConfig } from "@/hooks/useVoiceConfig";

const fetchWithAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/apiClient", () => ({ fetchWithAuth }));

const ok = () => ({
  ok: true,
  json: async () => ({
    tts: { provider: "gcp_gemini", voice: "Aoede", language: "da", capabilities: {} },
    stt: { provider: "disabled", capabilities: {} },
  }),
});

const BUBBLES = 25;
const mountBubbles = () =>
  Array.from({ length: BUBBLES }, () => renderHook(() => useVoiceConfig("skill-1", "act-1")));

beforeEach(() => {
  _resetVoiceConfigCacheForTests();
  fetchWithAuth.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useVoiceConfig request dedupe", () => {
  it("many bubbles mounting together send ONE request and all get the config", async () => {
    fetchWithAuth.mockResolvedValue(ok());
    const hooks = mountBubbles();
    await waitFor(() => expect(hooks.every((h) => h.result.current.tts.voice === "Aoede")).toBe(true));
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
  });

  it("a tab focus refetches once, not once per bubble", async () => {
    fetchWithAuth.mockResolvedValue(ok());
    mountBubbles();
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(1));

    // Inside the cooldown: no refetch at all.
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);

    // After it: exactly one, shared by every bubble.
    const later = Date.now() + 31_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(2));
    vi.restoreAllMocks();
  });

  it("after a failed fetch, newly mounted bubbles do not each retry", async () => {
    fetchWithAuth.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const first = renderHook(() => useVoiceConfig("skill-1", "act-1"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    const hooks = mountBubbles();
    await waitFor(() => expect(hooks.every((h) => !h.result.current.loading)).toBe(true));
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    // ...and they fall back to the safe default rather than hanging.
    expect(hooks[0].result.current.tts.provider).toBe("browser");
  });
});
