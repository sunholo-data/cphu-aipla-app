"use client";

import { LOCALES, useT } from "@/i18n";
import type { Locale } from "@/i18n/locale";
import { useUserLocale } from "@/i18n/userLocale";

/**
 * DA | EN — the person's own language (1.1.108). Remembered in this browser.
 *
 * Inside an activity, a choice made here outranks the activity's language for
 * the whole student screen, the tutor and the read-aloud voice (2026-09-30) —
 * one language everywhere, never buttons in one beside a tutor in another. A
 * person who never chose sees the activity's language, which is why the chat
 * passes `value`: the switch shows what is actually in force.
 *
 * Each option is written in its OWN language ("Dansk", "English") so a person
 * who cannot read the current one can still find theirs.
 */
export function LanguageSwitch({ className = "", value }: { className?: string; value?: Locale }) {
  const { locale: userLocale, setLocale } = useUserLocale();
  const locale = value ?? userLocale;
  const t = useT("LanguageSwitch", locale);
  return (
    <div role="group" aria-label={t("label")} className={`inline-flex overflow-hidden rounded border border-border text-xs ${className}`}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={locale === l}
          title={t(l)}
          onClick={() => setLocale(l)}
          className={`px-2 py-0.5 font-medium uppercase ${
            locale === l ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
