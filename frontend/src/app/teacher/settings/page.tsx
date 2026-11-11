"use client";

import Link from "next/link";
import { ArrowRight, Settings as SettingsIcon } from "lucide-react";

import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { useIsResearcher } from "@/hooks/useIsResearcher";

import { DefaultsCard } from "./_DefaultsCard";
import { useT } from "@/i18n";

/** Where the judge lenses live now (UI sweep 2026-11-11). Not exported: a
 *  page module may only export what Next.js expects of it. */
const LENSES_HREF = "/teacher/research/frameworks?tab=research";

/**
 * Settings index — the nav destination for teacher account + class-wide
 * defaults. Settings live where they apply, so this page points teachers to
 * them rather than implying they have moved.
 *
 * RUBRIC-1 M3 put the researcher judge-lens config here. It moved to the
 * tutors page's Research tools tab on 2026-11-11, beside the calibration of
 * the same judges, so Settings is the same small page for everyone. A
 * researcher who comes here out of habit gets one line saying where it went.
 */
export default function TeacherSettingsPage() {
  const t = useT("TeacherSettingsPage");
  const isResearcher = useIsResearcher();
  return (
    <TeacherPage title={t("title")}>
      <div className="flex flex-col gap-6">
        <DefaultsCard />
        {isResearcher ? (
          <p data-testid="lenses-moved" className="text-sm text-muted-foreground">
            {t("lensesMoved")}{" "}
            <Link href={LENSES_HREF} className="font-medium text-foreground underline underline-offset-4">
              {t("lensesMovedLink")}
            </Link>
          </p>
        ) : null}
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
