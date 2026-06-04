"use client";

/**
 * LangToggle — student's read-aloud language picker.
 *
 * Two-button toggle (DA / EN). Visually adjacent to the AutoReadToggle
 * so the audio preferences cluster together at the top of the chat.
 * Selection is per-browser via useVoiceLang.
 *
 * When unset, the toggle highlights the class/skill default visually
 * via the `defaultLang` prop so the student sees what they'll hear
 * if they don't pick.
 */

import { useVoiceLang, SUPPORTED_LANGS, type SupportedLang } from "@/hooks/useVoiceLang";

interface LangToggleProps {
  /** Class- or skill-resolved default lang from /api/voice/config.
   * Used as the "what you'll hear unless you pick" hint. Omit to
   * show no default. */
  defaultLang?: string | null;
  className?: string;
}

const LABEL: Record<SupportedLang, string> = {
  da: "DA",
  en: "EN",
};

export function LangToggle({ defaultLang, className }: LangToggleProps) {
  const { lang, setLang } = useVoiceLang();

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
        const isDefault = lang === null && defaultLang === l;
        const active = isPicked || isDefault;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLang(isPicked ? null : l)}
            aria-pressed={isPicked}
            title={
              isPicked
                ? `${LABEL[l]} — your choice`
                : isDefault
                  ? `${LABEL[l]} — class default`
                  : `Switch read-aloud to ${LABEL[l]}`
            }
            className={
              active
                ? "rounded-full bg-accent px-2 py-0.5 text-foreground"
                : "rounded-full px-2 py-0.5 hover:bg-accent/50 hover:text-foreground"
            }
          >
            {LABEL[l]}
            {isDefault && !isPicked ? <span aria-hidden="true">·</span> : null}
          </button>
        );
      })}
    </div>
  );
}
