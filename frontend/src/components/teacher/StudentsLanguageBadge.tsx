"use client";

// 1.1.151 F2b — the STUDENTS' language, shown as a badge where a teacher looks.
//
// Two activities of a Danish class were set to English; the students wrote
// Danish and the tutor answered in English every turn, exactly as told. The code
// was right; the value was wrong, and nothing on the card or in the builder made
// it visible. This badge is the language of the activity (data on the activity),
// not the teacher's own DA | EN screen setting.

import { Languages } from "lucide-react";

import { useT } from "@/i18n";
import type { Language } from "@/lib/teacherApi";

export function StudentsLanguageBadge({ language, className = "" }: { language: Language; className?: string }) {
  const t = useT("StudentsLanguageBadge");
  return (
    <span
      title={t("title")}
      data-testid="students-language-badge"
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground ${className}`}
    >
      <Languages className="h-3 w-3" aria-hidden="true" />
      {language === "en" ? t("en") : t("da")}
    </span>
  );
}
