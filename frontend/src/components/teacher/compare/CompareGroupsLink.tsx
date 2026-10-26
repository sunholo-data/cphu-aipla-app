"use client";

import Link from "next/link";
import { LayoutGrid } from "lucide-react";

import { useT } from "@/i18n";

/** The class page's one entry point to "compare one element across all groups"
 *  (1.1.99 M1). Its own component so the class page carries a single line. */
export function CompareGroupsLink({ classId }: { classId: string }) {
  const t = useT("ClassComparePage");
  return (
    <Link
      href={`/teacher/classes/${encodeURIComponent(classId)}/compare`}
      className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
    >
      <LayoutGrid className="h-4 w-4" aria-hidden="true" />
      {t("linkLabel")}
    </Link>
  );
}
