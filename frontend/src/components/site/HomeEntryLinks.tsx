"use client";

import Link from "next/link";

import { LanguageSwitch } from "@/components/site/LanguageSwitch";
import { TeacherEntryLink } from "@/components/site/TeacherEntryLink";
import { useT } from "@/i18n";

const secondary = "text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

/**
 * The homepage's doors (students → /group, teachers → sign-in), in the
 * person's own language (1.1.108). A client component because the homepage is
 * a server component and the language lives in this browser; the switch sits
 * here so a first-time visitor who cannot read the default finds theirs.
 */
export function HomeEntryLinks() {
  const t = useT("HomeEntry");
  return (
    <div className="flex flex-col items-center gap-3">
      <Link
        href="/group"
        className="rounded-lg bg-primary px-6 py-3 text-primary-foreground font-medium hover:opacity-90 transition-opacity"
      >
        {t("join")}
      </Link>
      <TeacherEntryLink />
      <Link href="/guides" className={secondary}>
        {t("guides")}
      </Link>
      <Link href="/project" className={secondary}>
        {t("aboutProject")}
      </Link>
      <LanguageSwitch className="mt-2" />
    </div>
  );
}
