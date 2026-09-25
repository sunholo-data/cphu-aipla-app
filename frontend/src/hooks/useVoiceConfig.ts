"use client";

/**
 * useVoiceConfig — fetch the voice provider config for a skill from
 * GET /api/voice/config. Returns the TTS provider + voice the frontend
 * should use (browser-native vs Cloud TTS) and the STT capabilities.
 *
 * Client cache: results are memoized per skillId for the lifetime of
 * the page. The config rarely changes within a session; refetching on
 * every assistant message would be wasteful.
 *
 * Failure mode: on network error, returns the safe default
 * `{ tts: { provider: "browser" }, stt: { provider: "disabled" } }`.
 * The browser-native path always works; the dictation button stays
 * hidden until config loads successfully.
 *
 * See voice-provider-abstraction.md (SEQUENCE 1.1.11).
 */

import { useCallback, useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/apiClient";

export interface VoiceCapabilities {
  tts: boolean;
  stt: boolean;
  streaming: boolean;
  languages: readonly string[];
}

export interface VoiceConfig {
  tts: {
    provider: string;
    voice: string | null;
    /** Class- or skill-resolved language hint from the backend (BCP-47
     * short form, e.g. "da"). Null when no override is set; in that
     * case the consumer should fall back to the skill's own ttsLang. */
    language: string | null;
    capabilities: VoiceCapabilities;
  };
  stt: {
    provider: string;
    capabilities: VoiceCapabilities;
  };
  /** VOICE-IN-REC — per-class capability flags the composer gates the mic on.
   * `voiceInput` (talk-to-type) also needs `stt.provider !== "disabled"`;
   * `recording` ("record this class") is independent. */
  capabilities: { voiceInput: boolean; recording: boolean };
  loading: boolean;
}

const DEFAULT_CONFIG: VoiceConfig = {
  tts: {
    provider: "browser",
    voice: null,
    language: null,
    capabilities: { tts: true, stt: false, streaming: false, languages: [] },
  },
  stt: {
    provider: "disabled",
    capabilities: { tts: false, stt: false, streaming: false, languages: [] },
  },
  capabilities: { voiceInput: false, recording: false },
  loading: false,
};

// Module-level cache. Keyed by skillId + activityId (or "_default_" for
// no-skill configs). Lives for the page session, refreshed on tab focus so
// teacher updates land within a tab-switch (not just a hard reload).
//
// 1.1.63 M4: activityId is part of the key, not just the query. Two activities
// in one class can differ in language and persona, and a skill-only key would
// serve the first one's voice to the second.
const _cache = new Map<string, Omit<VoiceConfig, "loading">>();

// One request per key, however many callers ask. This hook runs once PER
// MESSAGE BUBBLE, so without these a 40-message chat sent 40 requests on load
// and 40 more on every tab focus — and after a failed fetch (nothing cached)
// every bubble that mounted fetched again. Prod saw ~4,000 requests an hour
// from one class on 2026-09-22.
//  - _inflight: concurrent callers share the one pending request.
//  - _lastAttempt: success OR failure; a focus refetch or a post-failure
//    retry waits out REFETCH_MIN_MS instead of firing per bubble.
type LoadedConfig = Omit<VoiceConfig, "loading">;
const _inflight = new Map<string, Promise<LoadedConfig | null>>();
const _lastAttempt = new Map<string, number>();
const REFETCH_MIN_MS = 30_000;

function recentlyAttempted(cacheKey: string): boolean {
  const last = _lastAttempt.get(cacheKey);
  return last !== undefined && Date.now() - last < REFETCH_MIN_MS;
}

function loadConfig(cacheKey: string, url: string): Promise<LoadedConfig | null> {
  const pending = _inflight.get(cacheKey);
  if (pending) return pending;
  _lastAttempt.set(cacheKey, Date.now());
  const request = (async () => {
    try {
      const res = await fetchWithAuth(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as Partial<LoadedConfig>;
      // Normalize: an older deployed backend may not yet send `capabilities`.
      const data: LoadedConfig = {
        tts: raw.tts ?? DEFAULT_CONFIG.tts,
        stt: raw.stt ?? DEFAULT_CONFIG.stt,
        capabilities: raw.capabilities ?? DEFAULT_CONFIG.capabilities,
      };
      _cache.set(cacheKey, data);
      return data;
    } catch {
      return null;
    } finally {
      _inflight.delete(cacheKey);
    }
  })();
  _inflight.set(cacheKey, request);
  return request;
}

export function useVoiceConfig(
  skillId: string | null,
  /** The activity whose language + persona the voice must follow (1.1.63 M4).
   *  Distinct from skillId since ALS-1 M0. Omitted -> skill-only resolution,
   *  i.e. exactly the previous behaviour. */
  activityId?: string | null,
): VoiceConfig {
  const cacheKey = `${skillId ?? "_default_"}::${activityId ?? ""}`;
  const cached = _cache.get(cacheKey);

  const [config, setConfig] = useState<Omit<VoiceConfig, "loading">>(
    cached ?? DEFAULT_CONFIG,
  );
  const [loading, setLoading] = useState<boolean>(
    !cached && (_inflight.has(cacheKey) || !recentlyAttempted(cacheKey)),
  );

  // Shared fetch routine — used for the initial mount AND for the
  // on-focus refetch so teacher class-voice updates land quickly.
  const fetchConfig = useCallback(async (signal: { cancelled: boolean }) => {
    const params = new URLSearchParams();
    if (skillId) params.set("skill_id", skillId);
    if (activityId) params.set("activity_id", activityId);
    const qs = params.toString();
    const url = qs
      ? `/api/proxy/api/voice/config?${qs}`
      : `/api/proxy/api/voice/config`;
    const data = await loadConfig(cacheKey, url);
    if (signal.cancelled) return;
    if (data) setConfig(data);
    setLoading(false);
  }, [skillId, activityId, cacheKey]);

  useEffect(() => {
    const signal = { cancelled: false };
    if (cached) {
      setConfig(cached);
      setLoading(false);
    } else if (_inflight.has(cacheKey) || !recentlyAttempted(cacheKey)) {
      void fetchConfig(signal);
    } else {
      // A fetch for this key failed moments ago — keep the safe default
      // rather than re-asking once per newly mounted bubble.
      setLoading(false);
    }
    return () => {
      signal.cancelled = true;
    };
  }, [skillId, cacheKey, cached, fetchConfig]);

  // Refetch when the tab regains focus — gives teacher class-voice
  // updates a propagation path short of a full page reload. Background
  // re-fetch so the existing config stays visible until new data lands.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onFocus() {
      // Bubbles after the first join its in-flight request (so all of them
      // pick up the new config); only a SECOND focus inside the window skips.
      if (!_inflight.has(cacheKey) && recentlyAttempted(cacheKey)) return;
      const signal = { cancelled: false };
      void fetchConfig(signal);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchConfig, cacheKey]);

  return { ...config, loading };
}

/** Reset the module-level cache. Test helper; not exported in the bundle. */
export function _resetVoiceConfigCacheForTests(): void {
  _cache.clear();
  _inflight.clear();
  _lastAttempt.clear();
}
