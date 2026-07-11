"use client";

import Link from "next/link";
import { ArrowRight, Settings as SettingsIcon } from "lucide-react";

import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

import { LensConfigPanel } from "./_LensConfigPanel";

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
  return (
    <TeacherPage title="Settings">
      <div className="flex flex-col gap-6">
        <LensConfigPanel />
        <EmptyState
          icon={SettingsIcon}
          title="Account-wide defaults are coming here"
          description="For now, settings live where they apply: open a class to set its voice and read-aloud language (the “Voice (read-aloud)” panel), and set an activity’s language and difficulty in the activity builder."
          action={
            <Link
              href="/teacher/classes"
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Go to classes
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
        />
      </div>
    </TeacherPage>
  );
}
