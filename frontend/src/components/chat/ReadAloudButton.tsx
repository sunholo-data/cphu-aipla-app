"use client";

/**
 * ReadAloudButton — browser-native TTS button for tutor messages.
 *
 * Sprint 1.H-TTS (proactive-tutor design Part 1). Each tutor turn in
 * the chat renders one of these next to the timestamp. Click to have
 * the OS speak the message text via Web Speech API
 * (`window.speechSynthesis`); click again to cancel.
 *
 * Why browser TTS and not Gemini Live / ADK LiveRunner:
 *  - Zero backend changes (LiveRunner is a stub at backend/adk/live_agent.py)
 *  - No streaming complexity — the message is already fully rendered
 *  - No per-turn token cost
 *  - Works offline / with intermittent network
 *  - W3C standard, broad browser support (incl. mobile Safari)
 *
 * Tradeoffs:
 *  - Voice quality varies by OS (macOS Danish voice is excellent;
 *    Linux Danish coverage is patchier; Chrome OS uses Google voices).
 *  - No live streaming (audio plays after text fully renders — fine
 *    for tutor turns that arrive complete via AG-UI).
 *
 * If we ever need conversational voice in / voice out, that's the
 * separate Gemini Live sprint (audio-capture-and-tts.md Part 2 +
 * a future LiveRunner enablement).
 */

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ReadAloudButtonProps {
  /** Text to speak. Stripped of markdown / HTML before utterance. */
  text: string;
  /** BCP-47 language tag (e.g. "da", "en"). Defaults to "en". */
  lang?: string;
  /** Optional className to control sizing / colour from the parent. */
  className?: string;
}

function isSpeechSynthesisAvailable(): boolean {
  if (typeof window === "undefined") return false;
  // mobile Safari has the property but speak() may no-op without a
  // user gesture; we ship the button anyway and let the gesture work.
  // Check the value (not just the property's existence) — tests stub
  // `window.speechSynthesis = undefined` to simulate older browsers.
  return (
    Boolean((window as Window & { speechSynthesis?: unknown }).speechSynthesis) &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

/** Strip the most common markdown punctuation so the TTS engine
 *  doesn't try to read asterisks / underscores / backticks aloud.
 *  Keep it conservative — over-eager stripping would mangle math
 *  expressions in stx physics text. */
function plainTextForSpeech(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold**
    .replace(/\*([^*]+)\*/g, "$1") // *italic*
    .replace(/_([^_]+)_/g, "$1") // _italic_
    .replace(/`([^`]+)`/g, "$1") // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [link](url)
    .trim();
}

export function ReadAloudButton({
  text,
  lang = "en",
  className,
}: ReadAloudButtonProps) {
  const [available] = useState<boolean>(isSpeechSynthesisAvailable);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Always cancel any in-flight utterance when the component unmounts —
  // otherwise navigating away mid-speech leaves the OS still talking.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // No-op: some browsers throw if there's nothing to cancel.
        }
      }
    };
  }, []);

  if (!available) {
    return null;
  }

  function handleClick() {
    if (isSpeaking) {
      // User-initiated stop.
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore — state will recover below.
      }
      setIsSpeaking(false);
      utteranceRef.current = null;
      return;
    }

    const utt = new SpeechSynthesisUtterance(plainTextForSpeech(text));
    utt.lang = lang;
    // 0.85 sounds more natural for Danish + non-native English listeners
    // (default 1.0 is too fast for tutor turns). v2 may expose this in
    // skill config — see audio-capture-and-tts.md v2 polish notes.
    utt.rate = 0.85;
    utt.onend = () => {
      setIsSpeaking(false);
      utteranceRef.current = null;
    };
    utt.onerror = () => {
      // Network voice unavailable, etc. — fall back cleanly to idle
      // so the user can retry without a stuck UI.
      setIsSpeaking(false);
      utteranceRef.current = null;
    };
    utteranceRef.current = utt;
    try {
      window.speechSynthesis.speak(utt);
      setIsSpeaking(true);
    } catch {
      // Safari sometimes throws if speak() is called without a recent
      // user gesture. The button click IS a gesture so this is rare,
      // but bail cleanly if it happens.
      setIsSpeaking(false);
      utteranceRef.current = null;
    }
  }

  const label = isSpeaking ? "Stop reading aloud" : "Read aloud";
  const Icon = isSpeaking ? VolumeX : Volume2;
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={label}
      className={
        className ??
        "inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      }
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
