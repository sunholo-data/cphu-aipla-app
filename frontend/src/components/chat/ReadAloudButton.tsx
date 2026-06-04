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

/** Physics-unit and math-symbol substitutions per language.
 *
 *  Cloud TTS reads "9,82 m/s²" as "nine comma eight two m slash s
 *  squared" by default — every symbol gets spelled out. For a physics
 *  tutor that's both broken (loses meaning) and demo-killing
 *  (sounds robotic). We pre-translate the common units + math
 *  decorations into spelled-out words BEFORE handing the text to TTS.
 *
 *  Order matters: longer patterns first so "m/s²" matches before
 *  "m/s" and "²" individually.
 */
type UnitRule = [RegExp, string];

const COMMON_NUMBER_RULES: UnitRule[] = [
  // Treat decimal comma in numbers as a decimal point so TTS doesn't
  // say "comma" between digits. Works for both DA and EN listeners
  // (engine reads "9.82" as nine point eight two in both).
  [/(\d),(\d)/g, "$1.$2"],
];

const UNIT_RULES_EN: UnitRule[] = [
  // Speed + acceleration (longer matches first)
  [/(\d[\d.]*)\s*m\/s²/g, "$1 meters per second squared"],
  [/(\d[\d.]*)\s*m\/s\^2/g, "$1 meters per second squared"],
  [/(\d[\d.]*)\s*km\/h/g, "$1 kilometers per hour"],
  [/(\d[\d.]*)\s*m\/s/g, "$1 meters per second"],
  // Force + energy + power
  [/(\d[\d.]*)\s*kN/g, "$1 kilonewtons"],
  [/(\d[\d.]*)\s*N(?![a-z])/g, "$1 newtons"],
  [/(\d[\d.]*)\s*kJ/g, "$1 kilojoules"],
  [/(\d[\d.]*)\s*J(?![a-z])/g, "$1 joules"],
  [/(\d[\d.]*)\s*kW/g, "$1 kilowatts"],
  [/(\d[\d.]*)\s*W(?![a-z])/g, "$1 watts"],
  // Mass + distance + time
  [/(\d[\d.]*)\s*kg(?![a-z])/g, "$1 kilograms"],
  [/(\d[\d.]*)\s*g(?![a-z])/g, "$1 grams"],
  [/(\d[\d.]*)\s*km(?![a-z])/g, "$1 kilometers"],
  [/(\d[\d.]*)\s*cm(?![a-z])/g, "$1 centimeters"],
  [/(\d[\d.]*)\s*mm(?![a-z])/g, "$1 millimeters"],
  [/(\d[\d.]*)\s*m(?![a-z\/])/g, "$1 meters"],
  [/(\d[\d.]*)\s*min(?![a-z])/g, "$1 minutes"],
  [/(\d[\d.]*)\s*s(?![a-z])/g, "$1 seconds"],
  // Temperature
  [/(\d[\d.]*)\s*°C/g, "$1 degrees Celsius"],
  [/(\d[\d.]*)\s*°/g, "$1 degrees"],
  // Standalone math decorators
  [/²/g, " squared"],
  [/³/g, " cubed"],
  [/±/g, " plus or minus "],
  [/≈/g, " approximately "],
  [/≠/g, " not equal to "],
  [/≤/g, " less than or equal to "],
  [/≥/g, " greater than or equal to "],
  [/×/g, " times "],
  [/÷/g, " divided by "],
];

const UNIT_RULES_DA: UnitRule[] = [
  [/(\d[\d.]*)\s*m\/s²/g, "$1 meter per sekund i anden"],
  [/(\d[\d.]*)\s*m\/s\^2/g, "$1 meter per sekund i anden"],
  [/(\d[\d.]*)\s*km\/h/g, "$1 kilometer i timen"],
  [/(\d[\d.]*)\s*m\/s/g, "$1 meter per sekund"],
  [/(\d[\d.]*)\s*kN/g, "$1 kilonewton"],
  [/(\d[\d.]*)\s*N(?![a-zæøå])/g, "$1 newton"],
  [/(\d[\d.]*)\s*kJ/g, "$1 kilojoule"],
  [/(\d[\d.]*)\s*J(?![a-zæøå])/g, "$1 joule"],
  [/(\d[\d.]*)\s*kW/g, "$1 kilowatt"],
  [/(\d[\d.]*)\s*W(?![a-zæøå])/g, "$1 watt"],
  [/(\d[\d.]*)\s*kg(?![a-zæøå])/g, "$1 kilogram"],
  [/(\d[\d.]*)\s*g(?![a-zæøå])/g, "$1 gram"],
  [/(\d[\d.]*)\s*km(?![a-zæøå])/g, "$1 kilometer"],
  [/(\d[\d.]*)\s*cm(?![a-zæøå])/g, "$1 centimeter"],
  [/(\d[\d.]*)\s*mm(?![a-zæøå])/g, "$1 millimeter"],
  [/(\d[\d.]*)\s*m(?![a-zæøå\/])/g, "$1 meter"],
  [/(\d[\d.]*)\s*min(?![a-zæøå])/g, "$1 minutter"],
  [/(\d[\d.]*)\s*s(?![a-zæøå])/g, "$1 sekunder"],
  [/(\d[\d.]*)\s*°C/g, "$1 grader celsius"],
  [/(\d[\d.]*)\s*°/g, "$1 grader"],
  [/²/g, " i anden"],
  [/³/g, " i tredje"],
  [/±/g, " plus minus "],
  [/≈/g, " cirka "],
  [/≠/g, " forskellig fra "],
  [/≤/g, " mindre end eller lig "],
  [/≥/g, " større end eller lig "],
  [/×/g, " gange "],
  [/÷/g, " divideret med "],
];

function applyUnitRules(text: string, lang: string): string {
  // Decimal-comma normalisation runs regardless of lang.
  let out = text;
  for (const [re, sub] of COMMON_NUMBER_RULES) {
    out = out.replace(re, sub);
  }
  const rules = lang.startsWith("da") ? UNIT_RULES_DA : UNIT_RULES_EN;
  for (const [re, sub] of rules) {
    out = out.replace(re, sub);
  }
  return out;
}

/** Strip markdown / LaTeX / emoji so the TTS engine doesn't read raw
 *  syntax aloud ("**bold**" → "star star bold star star", $$ x = 5 $$
 *  → "dollar dollar x equals five dollar dollar", "👇" → "down finger").
 *
 *  Also substitutes common physics units + math symbols (m/s², 9,82,
 *  ²/³, ±, etc.) into spelled-out language-appropriate text so Cloud
 *  TTS produces natural-sounding physics narration instead of letter-
 *  by-letter spelling.
 *
 *  Aggressive enough to fix the demo bugs the teacher saw; conservative
 *  enough to keep math VALUES readable.
 */
function plainTextForSpeech(text: string, lang: string = "en"): string {
  const stripped = text
    // 1. Block LaTeX: $$...$$ and \[ ... \]
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\\\[[\s\S]*?\\\]/g, " ")
    // 2. Inline LaTeX: $...$ (greedy enough but not multi-line — collapse)
    .replace(/\$([^$\n]+)\$/g, " $1 ")
    // 3. Code fences (```lang\n...\n```)
    .replace(/```[\s\S]*?```/g, " ")
    // 4. Inline markdown decoration
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold**
    .replace(/__([^_]+)__/g, "$1") // __bold__
    .replace(/\*([^*]+)\*/g, "$1") // *italic*
    .replace(/_([^_]+)_/g, "$1") // _italic_
    .replace(/`([^`]+)`/g, "$1") // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [link](url)
    // 5. Headings + list bullets at start of line
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // 6. Block-quote markers + horizontal rules
    .replace(/^>\s?/gm, "")
    .replace(/^-{3,}|_{3,}|\*{3,}$/gm, "")
    // 7. Emoji + dingbats + arrows. Cloud TTS reads "👇" as "down
    //    pointing backhand index". Stripping the common pictographic
    //    BMP-supplementary planes catches almost all of them.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu, " ");

  // 8. Unit + math symbol substitutions (language-aware).
  const spoken = applyUnitRules(stripped, lang);

  // 9. Collapse whitespace.
  return spoken.replace(/\s+/g, " ").trim();
}

/** Detect the text's language from content so we don't read Danish
 *  prose with English phonemes (or vice versa).
 *
 *  Strategy:
 *  - If the text contains Danish-only chars (æøåÆØÅ), it's Danish.
 *  - Otherwise we trust the caller's `lang` prop (skill default or
 *    class override). This is conservative — we'd rather over-trust
 *    the skill than guess wrong on a short prompt.
 *
 *  Returns the BCP-47 short tag ("da" / "en") to use for synthesis.
 */
function detectLangForSpeech(text: string, fallback: string): string {
  if (/[æøåÆØÅ]/.test(text)) return "da";
  return fallback;
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
  //
  // Important: we deliberately do NOT include `lang` or `voice` in the
  // dep array. Changing the read-aloud language mid-conversation
  // should NOT re-speak the current message in the new language —
  // only the NEXT message uses the new lang. The LangToggle dispatches
  // a voice.cancel event to stop any in-flight playback when switched.
  //
  // 2026-06-04 hardening (`hasAutoReadRef`):
  // Each ReadAloudButton instance auto-reads at most ONCE per mount.
  // Re-renders triggered by setting changes (LangToggle, AutoReadToggle,
  // useVoiceConfig refetch on tab focus) used to re-fire the effect on
  // OLDER message bubbles whose text had already been read — the
  // student would hear the previous assistant turn replayed after
  // changing a setting, then get cut off when the new assistant turn
  // arrived. The ref tracks "did we already attempt auto-read for this
  // mount" and short-circuits all subsequent attempts.
  //
  // Debounce: streaming messages incrementally update `text` (token by
  // token). Without a delay, the FIRST token kicks off auto-read with
  // a partial sentence; the rest of the stream never gets spoken. The
  // 600ms debounce waits for streaming to settle before reading the
  // final text exactly once.
  const hasAutoReadRef = useRef(false);
  useEffect(() => {
    if (!autoSpeakOnMount || !available || isSpeaking) return;
    if (hasAutoReadRef.current) return;
    const timer = setTimeout(() => {
      if (hasAutoReadRef.current) return; // double-check inside the timer
      hasAutoReadRef.current = true;
      handleClick();
    }, 600);
    return () => clearTimeout(timer);
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
    const cleanText = plainTextForSpeech(text, lang);
    // Auto-detect language from the actual text — if the tutor responded
    // in Danish but the caller passed lang="en" (because the class is
    // English-default), reading Danish prose with English phonemes
    // sounds hilarious + broken. Detection overrides the caller's lang
    // when the text is clearly Danish.
    const detectedLang = detectLangForSpeech(cleanText, lang);
    // M-A7 diagnostic — temporary.
    // eslint-disable-next-line no-console
    console.log("[ReadAloudButton] speakViaGCP() POST", { passedLang: lang, detectedLang, voice });
    try {
      const res = await fetchWithAuth("/api/proxy/api/voice/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: cleanText,
          lang: detectedLang,
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
        const utt = new SpeechSynthesisUtterance(cleanText);
        utt.lang = detectedLang;
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
      const utt = new SpeechSynthesisUtterance(cleanText);
      utt.lang = detectedLang;
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
    // Barge-in: cancel any other ReadAloudButton currently speaking
    // before we start, so two bubbles can't overlap. Each instance's
    // voice.cancel listener does the actual stop work; we just fire the
    // event. The dispatch is synchronous so by the time we fall through
    // to speakViaGCP / speechSynthesis.speak, the other instance's
    // audio is already paused and its blob URL revoked.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("aipla:voice.cancel"));
    }
    if (useGCP) {
      void speakViaGCP();
      return;
    }
    const cleanText = plainTextForSpeech(text, lang);
    const detectedLang = detectLangForSpeech(cleanText, lang);
    const utt = new SpeechSynthesisUtterance(cleanText);
    utt.lang = detectedLang;
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
