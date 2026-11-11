"use client";

import Link from "next/link";
import { ArrowRight, LayoutGrid } from "lucide-react";

import { useT } from "@/i18n";

/** The class page's one entry point to "compare one element across all groups"
 *  (1.1.99 M1). Its own component so the class page carries a single line.
 *
 *  UI sweep 2026-11: moved from the page header (where it competed with the
 *  title) into the "Efter lektionen" view, as a card that says what it shows. */
export function CompareGroupsLink({ classId }: { classId: string }) {
  const t = useT("ClassComparePage");
  return (
    <Link
      href={`/teacher/classes/${encodeURIComponent(classId)}/compare`}
      className="flex items-center gap-3 rounded border border-border px-4 py-3 hover:bg-muted"
    >
      <LayoutGrid className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1 text-sm font-medium">
          {t("linkLabel")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="text-xs text-muted-foreground">{t("linkHint")}</span>
      </span>
    </Link>
  );
}
