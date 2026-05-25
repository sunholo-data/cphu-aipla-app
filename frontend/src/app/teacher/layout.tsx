import Link from "next/link";
import type { ReactNode } from "react";
import { GraduationCap, LogOut } from "lucide-react";

import { AppFooter } from "@/components/AppFooter";
import { BRANDING } from "@/lib/branding";
import { isLocalMode } from "@/lib/localMode";

import { MOCK_TEACHER } from "./_mock-data";

function isTeacherMockBypass(): boolean {
  return isLocalMode() || process.env.NEXT_PUBLIC_TEACHER_MOCK === "1";
}

export default function TeacherLayout({ children }: { children: ReactNode }) {
  if (!isTeacherMockBypass()) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
        <GraduationCap className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">Teacher sign-in required</h1>
        <p className="text-sm text-muted-foreground">
          The teacher dashboard is in mockup mode. Set{" "}
          <code className="rounded bg-muted px-1 py-0.5">NEXT_PUBLIC_TEACHER_MOCK=1</code>{" "}
          or run with <code className="rounded bg-muted px-1 py-0.5">LOCAL_MODE</code> to
          preview it.
        </p>
        <Link className="text-sm underline" href="/">
          Go home
        </Link>
      </main>
    );
  }
  return <TeacherShell>{children}</TeacherShell>;
}

function TeacherShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/teacher/classes"
            className="flex items-center gap-2 text-sm font-semibold hover:opacity-80"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={BRANDING.logo.headerMark}
              alt=""
              aria-hidden="true"
              className="h-6 w-6"
            />
            <span>{BRANDING.appName} Teacher</span>
          </Link>

          <div className="flex items-center gap-3">
            <div
              role="status"
              aria-label="Mockup mode banner"
              className="hidden rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 sm:block dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
            >
              Mockup — Phase 1 (no live data)
            </div>
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
              aria-label={`Signed in as ${MOCK_TEACHER.displayName}`}
            >
              {MOCK_TEACHER.initials}
            </div>
            <button
              type="button"
              disabled
              title="Sign-out is wired in Phase 3"
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground opacity-60"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      <div className="mx-auto flex w-full max-w-6xl justify-center px-4 pb-6 sm:px-6">
        <AppFooter />
      </div>
    </div>
  );
}
