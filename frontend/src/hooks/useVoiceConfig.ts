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

import { useEffect, useState } from "react";
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
    capabilities: VoiceCapabilities;
  };
  stt: {
    provider: string;
    capabilities: VoiceCapabilities;
  };
  loading: boolean;
}

const DEFAULT_CONFIG: VoiceConfig = {
  tts: {
    provider: "browser",
    voice: null,
    capabilities: { tts: true, stt: false, streaming: false, languages: [] },
  },
  stt: {
    provider: "disabled",
    capabilities: { tts: false, stt: false, streaming: false, languages: [] },
  },
  loading: false,
};

// Module-level cache. Keyed by skillId (or "_default_" for no-skill
// configs). Lives for the page session — no LRU because skills/page
// counts are small.
const _cache = new Map<string, Omit<VoiceConfig, "loading">>();

export function useVoiceConfig(skillId: string | null): VoiceConfig {
  const cacheKey = skillId ?? "_default_";
  const cached = _cache.get(cacheKey);

  const [config, setConfig] = useState<Omit<VoiceConfig, "loading">>(
    cached ?? DEFAULT_CONFIG,
  );
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    if (cached) {
      setConfig(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const url = skillId
      ? `/api/proxy/api/voice/config?skill_id=${encodeURIComponent(skillId)}`
      : `/api/proxy/api/voice/config`;
    fetchWithAuth(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Omit<VoiceConfig, "loading">;
        if (!cancelled) {
          _cache.set(cacheKey, data);
          setConfig(data);
          setLoading(false);
        }
      })
      .catch(() => {
        // Stay on the safe default. Don't cache the failure — a transient
        // 503 should retry on the next mount.
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, cacheKey, cached]);

  return { ...config, loading };
}

/** Reset the module-level cache. Test helper; not exported in the bundle. */
export function _resetVoiceConfigCacheForTests(): void {
  _cache.clear();
}
