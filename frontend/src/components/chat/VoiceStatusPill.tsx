"use client";

/**
 * VoiceStatusPill — visible debug indicator showing which voice the
 * read-aloud is currently using. Lives next to the LangToggle so
 * teachers + students can see what the resolution chain landed on
 * without opening DevTools.
 *
 * Shows: <provider tier> · <voice name> · <source>
 * Where <source> is "class" / "skill" / "default" so it's obvious
 * who set what.
 */

import { Mic2 } from "lucide-react";

import type { VoiceConfig } from "@/hooks/useVoiceConfig";
import { useVoiceLang } from "@/hooks/useVoiceLang";

interface Props {
  voiceConfig: VoiceConfig;
}

/** Short tier label from the registry provider name. */
function tierLabel(provider: string): string {
  if (provider === "browser") return "Browser";
  if (provider === "gcp_standard") return "Standard";
  if (provider === "gcp_wavenet") return "WaveNet";
  if (provider === "gcp_neural2") return "Neural2";
  if (provider === "gcp_chirp3hd") return "Chirp3 HD";
  return provider;
}

export function VoiceStatusPill({ voiceConfig }: Props) {
  const { lang: studentLang } = useVoiceLang();
  const { provider, voice, language } = voiceConfig.tts;

  // Determine the source of the active voice:
  //   class — server returned a voice (only happens when class override
  //           OR skill SKILL.md block is set; class wins when both)
  //   skill — same as class for display purposes (we can't tell apart
  //           server-side without an extra field; future: surface)
  //   default — no voice override anywhere; provider's auto-pick
  const sourceLabel = voice ? "skill/class" : "default";
  const langLabel = studentLang
    ? `${studentLang} (you)`
    : language
      ? `${language} (class)`
      : "auto";

  if (voiceConfig.loading) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
        <Mic2 className="h-3 w-3" aria-hidden="true" />
        loading voice...
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
      title={`Provider: ${provider}\nVoice: ${voice ?? "(provider default)"}\nLanguage: ${langLabel}\nSource: ${sourceLabel}`}
    >
      <Mic2 className="h-3 w-3" aria-hidden="true" />
      <span className="font-medium">{tierLabel(provider)}</span>
      {voice ? <span className="opacity-70">· {voice}</span> : null}
      <span className="opacity-70">· {langLabel}</span>
    </span>
  );
}
