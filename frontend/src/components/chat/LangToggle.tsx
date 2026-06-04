"use client";

/**
 * LangToggle — student's read-aloud language picker.
 *
 * Two modes:
 *   - **Locked**: when a skill or class commits to a specific language
 *     via SkillVoiceConfig.language / ClassVoiceSettings.language, the
 *     toggle renders as a single non-clickable pill with a Lock icon
 *     and a "This lesson is in <lang>" tooltip. Picking a different
 *     language wouldn't actually change what the tutor writes, only
 *     mismatch the voice phonemes with the text — so we hide the
 *     option entirely. Honest about the constraint.
 *   - **Free**: when no skill / class lang is set, the student can
 *     pick between DA / EN. Choice persists via useVoiceLang.
 */

import { Lock } from "lucide-react";

import { useVoiceLang, SUPPORTED_LANGS, type SupportedLang } from "@/hooks/useVoiceLang";

interface LangToggleProps {
  /** Class- or skill-resolved default lang from /api/voice/config. When
   * set, the toggle renders in locked mode (student can't override
   * the skill's commitment to teaching in this language). */
  defaultLang?: string | null;
  className?: string;
}

const LABEL: Record<SupportedLang, string> = {
  da: "DA",
  en: "EN",
};

const FULL: Record<SupportedLang, string> = {
  da: "Dansk",
  en: "English",
};

function isSupported(lang: string | null | undefined): lang is SupportedLang {
  return lang === "da" || lang === "en";
}

export function LangToggle({ defaultLang, className }: LangToggleProps) {
  const { lang, setLang } = useVoiceLang();

  // Locked mode: skill or class has committed to a language. The
  // student lang preference is ignored (we don't even render the
  // other option) because picking it wouldn't change the tutor's
  // response language, only mismatch phonemes with text.
  if (isSupported(defaultLang)) {
    return (
      <span
        className={
          className ??
          "inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
        }
        title={`This lesson is in ${FULL[defaultLang]} — the tutor responds in ${FULL[defaultLang]}, so the audio language is locked to match.`}
      >
        <Lock className="h-3 w-3" aria-hidden="true" />
        <span className="font-medium">{LABEL[defaultLang]}</span>
        <span className="opacity-70">· {FULL[defaultLang]}</span>
      </span>
    );
  }

  return (
    <div
      className={
        className ??
        "inline-flex items-center gap-0.5 rounded-full border bg-background p-0.5 text-[10px] text-muted-foreground"
      }
      role="group"
      aria-label="Read-aloud language"
    >
      {SUPPORTED_LANGS.map((l) => {
        const isPicked = lang === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLang(isPicked ? null : l)}
            aria-pressed={isPicked}
            title={
              isPicked
                ? `${LABEL[l]} — your choice`
                : `Switch read-aloud to ${LABEL[l]}`
            }
            className={
              isPicked
                ? "rounded-full bg-accent px-2 py-0.5 text-foreground"
                : "rounded-full px-2 py-0.5 hover:bg-accent/50 hover:text-foreground"
            }
          >
            {LABEL[l]}
          </button>
        );
      })}
    </div>
  );
}
