"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { GraduationCap, LogOut } from "lucide-react";

import { AppFooter } from "@/components/AppFooter";
import { TeacherNav } from "@/components/teacher/ui/TeacherNav";
import { BRANDING } from "@/lib/branding";
import { isLocalMode } from "@/lib/localMode";
import { signOut } from "@/lib/firebase";
import { useTeacherAuth } from "@/hooks/useTeacherAuth";

/**
 * Client shell for /teacher/* routes.
 *
 * Handles Firebase auth gate (redirects to /teacher/sign-in when no
 * teacher is signed in) and renders the persistent header + footer.
 * Extracted from layout.tsx so the parent can remain a server component.
 */
export function TeacherClientShell({ children }: { children: ReactNode }) {
  const { user, loading } = useTeacherAuth();

  // Show a minimal loading state while Firebase auth resolves.
  // useTeacherAuth will redirect to /teacher/sign-in if auth fails —
  // keep this node mounted until that redirect fires.
  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  // After loading: if there's no user and we're not in LOCAL_MODE, the
  // redirect to /teacher/sign-in is in flight from useTeacherAuth.
  // Render children bare (no header) so the sign-in page itself is visible.
  if (!user && !isLocalMode()) return <>{children}</>;

  const displayName =
    (user as { displayName?: string | null } | null)?.displayName ?? "Teacher";
  const initials = displayName
    .split(" ")
    .map((w: string) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase() || "T";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/teacher/classes"
            className="flex items-center gap-2 text-sm font-semibold hover:opacity-80"
          >
            <GraduationCap className="h-5 w-5" aria-hidden="true" />
            <span>{BRANDING.appName} Teacher</span>
          </Link>

          <div className="flex items-center gap-3">
            {isLocalMode() ? (
              <div
                role="status"
                aria-label="Local mode banner"
                className="hidden rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 sm:block dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
              >
                LOCAL_MODE
              </div>
            ) : null}
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
              aria-label={`Signed in as ${displayName}`}
              title={displayName}
            >
              {initials}
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 px-4 sm:px-6">
        <TeacherNav />
        {/* pb-24 on mobile clears the fixed bottom nav bar; reset at md. */}
        <div className="flex min-w-0 flex-1 flex-col md:pl-6">
          <main className="flex-1 py-6 pb-24 sm:py-8 md:pb-8">{children}</main>
          <div className="flex justify-center pb-24 md:pb-6">
            <AppFooter />
          </div>
        </div>
      </div>
    </div>
  );
}
