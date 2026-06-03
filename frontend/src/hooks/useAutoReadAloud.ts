"use client";

/**
 * useAutoReadAloud — student preference for auto-speaking every tutor
 * message on stream-complete. Persisted to localStorage so the choice
 * survives page reloads.
 *
 * Three pieces:
 *  1. `enabled` — current toggle state (boolean, default false).
 *  2. `toggle()` — flip the state.
 *  3. `cancelInFlight()` — fire a `voice.cancel` CustomEvent. Components
 *     that are playing audio (ReadAloudButton) listen for this and
 *     stop. Used by the chat input's typing handler and the dictate
 *     button to barge in on auto-read.
 *
 * Barge-in handler:
 *   When the toggle is ON, any keystroke in the chat input dispatches
 *   `voice.cancel`. ReadAloudButton stops playback. This is the
 *   "AI talks over me" prevention — students who start typing want
 *   silence immediately.
 *
 * Pairs with proactive-sim-reactive-tutor (1.1.2): when auto-read is
 * on, proactive tutor turns auto-speak the same as any other assistant
 * message — no special-casing in the consumer.
 *
 * See voice-provider-abstraction.md §Design "Auto-read toggle".
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "aipla.voice.auto_read";

/** Event name dispatched by `cancelInFlight()`. Listened to by any
 * component currently playing audio so it can stop on barge-in. */
export const VOICE_CANCEL_EVENT = "aipla:voice.cancel";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export interface AutoReadAloudHook {
  enabled: boolean;
  toggle: () => void;
  cancelInFlight: () => void;
}

export function useAutoReadAloud(): AutoReadAloudHook {
  const [enabled, setEnabled] = useState<boolean>(readInitial);

  // Keep tab-to-tab in sync — if the student flips the toggle in one
  // tab, other tabs pick it up via the storage event.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        setEnabled(e.newValue === "1");
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
        }
      } catch {
        // localStorage may be disabled (private mode). Toggle still
        // works for the session — the choice just doesn't persist.
      }
      // If we just turned it OFF mid-utterance, fire cancel so playback
      // stops immediately.
      if (!next && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(VOICE_CANCEL_EVENT));
      }
      return next;
    });
  }, []);

  const cancelInFlight = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(VOICE_CANCEL_EVENT));
    }
  }, []);

  return { enabled, toggle, cancelInFlight };
}
