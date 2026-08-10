/**
 * The voice config is asked for BY ACTIVITY (1.1.63 M4 / PILOT-1 M6).
 *
 * Aswin, 2026-08-10: *"I play the voice to read the text, but when reading the
 * text in English, numbers are still pronounced in Danish."* The language is
 * resolved server-side in `resolve_voice` — the single source of truth shared
 * by /config and /synthesize — but that resolver can only see the activity if
 * we ask it about the activity.
 *
 * ALS-1 M0 made the activity a first-class `act-…` id distinct from the skill
 * id, and this call site was never updated. So the request said "skill" and
 * the server resolved nothing for any modern activity.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVoiceConfig } from "@/hooks/useVoiceConfig";

const fetchWithAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/apiClient", () => ({ fetchWithAuth }));

function okResponse(language: string, voice: string) {
  return {
    ok: true,
    json: async () => ({
      tts: { provider: "gcp_gemini", voice, language, capabilities: {} },
      stt: { provider: "disabled", capabilities: {} },
      capabilities: { voiceInput: false, recording: false },
    }),
  };
}

beforeEach(() => {
  fetchWithAuth.mockReset();
  fetchWithAuth.mockResolvedValue(okResponse("da", "Puck"));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useVoiceConfig activity scoping", () => {
  it("asks for the config by activity, not only by skill", async () => {
    renderHook(() => useVoiceConfig("concept-dialogue", "act-1ac66271da35ee85"));
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());

    const url = String(fetchWithAuth.mock.calls[0][0]);
    expect(url).toContain("skill_id=concept-dialogue");
    expect(url).toContain("activity_id=act-1ac66271da35ee85");
  });

  it("omits activity_id when there is no activity", async () => {
    renderHook(() => useVoiceConfig("concept-dialogue"));
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());

    const url = String(fetchWithAuth.mock.calls[0][0]);
    expect(url).toContain("skill_id=concept-dialogue");
    expect(url).not.toContain("activity_id");
  });

  it("caches per activity, not per skill", async () => {
    // Two activities in one class can differ in language and persona. A
    // skill-only cache key would serve the first one's voice to the second —
    // and the module-level cache outlives the component, so the wrong voice
    // would stick for the rest of the page session.
    fetchWithAuth.mockResolvedValueOnce(okResponse("da", "Puck"));
    const first = renderHook(() => useVoiceConfig("concept-dialogue", "act-danish"));
    await waitFor(() => expect(first.result.current.tts.language).toBe("da"));

    fetchWithAuth.mockResolvedValueOnce(okResponse("en", "Puck"));
    const second = renderHook(() => useVoiceConfig("concept-dialogue", "act-english"));
    await waitFor(() => expect(second.result.current.tts.language).toBe("en"));

    expect(fetchWithAuth).toHaveBeenCalledTimes(2);
  });
});
