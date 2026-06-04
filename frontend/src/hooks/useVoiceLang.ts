"use client";

/**
 * useVoiceLang — student's preferred read-aloud language.
 *
 * Resolution order (highest wins):
 *   1. Student localStorage preference (this hook)
 *   2. Class-level language (resolved server-side in /api/voice/config
 *      and exposed via voiceConfig.tts.language)
 *   3. Skill's ttsLang prop (from skill metadata)
 *
 * The student's choice survives reloads and is per-browser (no sync
 * across devices). Empty value = "use server default".
 *
 * See voice-provider-abstraction.md §Auto-read toggle for the pairing
 * with useAutoReadAloud (same persistence shape, same barge-in event
 * channel).
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "aipla.voice.lang";

/** Languages we currently support in the picker. Add new ones here +
 * to the backend CURATED_VOICES dict. */
export const SUPPORTED_LANGS = ["da", "en"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

function readInitial(): SupportedLang | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "da" || v === "en") return v;
    return null;
  } catch {
    return null;
  }
}

export interface VoiceLangHook {
  /** Student's chosen lang, or null if they haven't set one (use server default). */
  lang: SupportedLang | null;
  /** Set the student's preferred language. Pass null to clear and fall
   * through to class / skill defaults. */
  setLang: (next: SupportedLang | null) => void;
}

export function useVoiceLang(): VoiceLangHook {
  const [lang, setLangState] = useState<SupportedLang | null>(readInitial);

  // Sync across tabs.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        const v = e.newValue;
        setLangState(v === "da" || v === "en" ? v : null);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setLang = useCallback((next: SupportedLang | null) => {
    setLangState(next);
    try {
      if (typeof window === "undefined") return;
      if (next === null) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // localStorage disabled (private mode) — session-only state.
    }
  }, []);

  return { lang, setLang };
}
