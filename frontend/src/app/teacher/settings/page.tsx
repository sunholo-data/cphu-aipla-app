"use client";

import Link from "next/link";
import { ArrowRight, Settings as SettingsIcon } from "lucide-react";

import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

import { DefaultsCard } from "./_DefaultsCard";
import { LensConfigPanel } from "./_LensConfigPanel";
import { useT } from "@/i18n";

/**
 * Settings index — the nav destination for teacher account + class-wide
 * defaults. Placeholder for now (P2): account-level defaults land here in a
 * later phase. Until then, settings live where they apply, so this page
 * points teachers to them rather than implying they have moved.
 *
 * RUBRIC-1 M3: researcher accounts additionally get the judge-lens config
 * panel here (renders null for everyone else — the placeholder is unchanged
 * for plain teachers).
 */
export default function TeacherSettingsPage() {
  const t = useT("TeacherSettingsPage");
  return (
    <TeacherPage title={t("title")}>
      <div className="flex flex-col gap-6">
        <DefaultsCard />
        <LensConfigPanel />
        <EmptyState
          icon={SettingsIcon}
          title={t("elsewhereTitle")}
          description={t("elsewhereBody")}
          action={
            <Link
              href="/teacher/classes"
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              {t("goToClasses")}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
        />
      </div>
    </TeacherPage>
  );
}
