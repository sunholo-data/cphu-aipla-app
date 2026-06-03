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
import { fetchWithAuth } from "@/lib/apiClient";

interface ReadAloudButtonProps {
  /** Text to speak. Stripped of markdown / HTML before utterance. */
  text: string;
  /** BCP-47 language tag (e.g. "da", "en"). Defaults to "en". */
  lang?: string;
  /** Voice provider. `"browser"` (default) uses window.speechSynthesis.
   * `"gcp_wavenet"`, `"gcp_neural2"`, etc. POST to /api/voice/tts/synthesize
   * and play the returned audio blob. From useVoiceConfig in
   * MessageBubble. */
  provider?: string;
  /** Optional provider-specific voice name (e.g. `"da-DK-Wavenet-A"`).
   * Only used when provider is a non-browser tier. */
  voice?: string | null;
  /** Optional skill id passed through to the synthesize endpoint so
   * server-side cost spans tag the right skill. */
  skillId?: string;
  /** Optional className to control sizing / colour from the parent. */
  className?: string;
  /** 1.1.11 auto-read: when true, the button auto-fires once on mount.
   * Used by MessageBubble when the student has the auto-read toggle on,
   * so the assistant turn is spoken automatically. */
  autoSpeakOnMount?: boolean;
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
  provider = "browser",
  voice = null,
  skillId,
  className,
  autoSpeakOnMount = false,
}: ReadAloudButtonProps) {
  const useGCP = provider !== "browser";
  // We only need Web Speech availability for the browser-native path.
  // GCP path uses the standard Audio() element which is universally
  // available on every browser we ship to.
  const [available] = useState<boolean>(() => (useGCP ? true : isSpeechSynthesisAvailable()));
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // Always cancel any in-flight utterance / audio when the component
  // unmounts — otherwise navigating away mid-speech leaves the OS still
  // talking or the audio element leaks the blob URL.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // No-op: some browsers throw if there's nothing to cancel.
        }
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, []);

  // 1.1.11 — listen for the global voice.cancel event so barge-in
  // (typing, dictating, auto-read toggle off) stops in-flight audio.
  // See useAutoReadAloud for the dispatch sites.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onCancel() {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // Ignore.
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      utteranceRef.current = null;
      setIsSpeaking(false);
    }
    window.addEventListener("aipla:voice.cancel", onCancel);
    return () => window.removeEventListener("aipla:voice.cancel", onCancel);
  }, []);

  // 1.1.11 auto-read: when the parent flips this prop on (typically
  // because a new assistant message arrived AND the auto-read toggle is
  // on), fire the click once. Placed BEFORE the early return below so
  // the hook ordering stays stable (react-hooks/rules-of-hooks).
  useEffect(() => {
    if (!autoSpeakOnMount || !available || isSpeaking) return;
    handleClick();
    // We want this to fire once per (text, autoSpeakOnMount=true)
    // transition. handleClick is intentionally not in deps — it'd
    // recreate every render and cause spam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSpeakOnMount, text]);

  if (!available) {
    return null;
  }

  function stopAll() {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // Ignore.
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    utteranceRef.current = null;
    setIsSpeaking(false);
  }

  async function speakViaGCP(): Promise<void> {
    // M-A7 diagnostic — temporary.
    // eslint-disable-next-line no-console
    console.log("[ReadAloudButton] speakViaGCP() POST /api/proxy/api/voice/tts/synthesize", { lang, voice });
    try {
      const res = await fetchWithAuth("/api/proxy/api/voice/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: plainTextForSpeech(text),
          lang,
          voice,
          skillId,
        }),
      });
      // eslint-disable-next-line no-console
      console.log("[ReadAloudButton] synthesize response", {
        status: res.status,
        contentType: res.headers.get("content-type"),
        provider: res.headers.get("x-voice-provider"),
        cacheHit: res.headers.get("x-voice-cache-hit"),
      });
      if (!res.ok) throw new Error(`synthesize ${res.status}`);
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.startsWith("application/json")) {
        // Server signalled "use browser" — fall through.
        const utt = new SpeechSynthesisUtterance(plainTextForSpeech(text));
        utt.lang = lang;
        utt.rate = 0.85;
        utt.onend = stopAll;
        utt.onerror = stopAll;
        utteranceRef.current = utt;
        window.speechSynthesis.speak(utt);
        setIsSpeaking(true);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = stopAll;
      audio.onerror = stopAll;
      await audio.play();
      setIsSpeaking(true);
    } catch {
      // Synthesize failed — degrade to browser-native so the user
      // still hears something.
      const utt = new SpeechSynthesisUtterance(plainTextForSpeech(text));
      utt.lang = lang;
      utt.rate = 0.85;
      utt.onend = stopAll;
      utt.onerror = stopAll;
      utteranceRef.current = utt;
      try {
        window.speechSynthesis.speak(utt);
        setIsSpeaking(true);
      } catch {
        stopAll();
      }
    }
  }

  function handleClick() {
    // M-A7 diagnostic — temporary; helps us tell from DevTools whether
    // the click is reaching this handler at all and which branch fires.
    // Remove once Cloud TTS path is verified end-to-end in dev.
    // eslint-disable-next-line no-console
    console.log("[ReadAloudButton] click", { provider, voice, lang, useGCP, isSpeaking });
    if (isSpeaking) {
      stopAll();
      return;
    }
    if (useGCP) {
      void speakViaGCP();
      return;
    }
    const utt = new SpeechSynthesisUtterance(plainTextForSpeech(text));
    utt.lang = lang;
    utt.rate = 0.85;
    utt.onend = stopAll;
    utt.onerror = stopAll;
    utteranceRef.current = utt;
    try {
      window.speechSynthesis.speak(utt);
      setIsSpeaking(true);
    } catch {
      stopAll();
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
