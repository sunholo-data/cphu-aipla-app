"use client";

import { LOCALES, useT } from "@/i18n";
import { useUserLocale } from "@/i18n/userLocale";

/**
 * DA | EN — the person's own language (1.1.108). Remembered in this browser.
 *
 * It never changes an ACTIVITY's language: inside an activity the students'
 * language, set by the teacher, wins — the tutor speaks it too, and buttons in
 * one language beside a tutor in another is the bug this work removed.
 *
 * Each option is written in its OWN language ("Dansk", "English") so a person
 * who cannot read the current one can still find theirs.
 */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useUserLocale();
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
