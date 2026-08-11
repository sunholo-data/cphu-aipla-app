"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FlaskConical, HelpCircle, LogOut } from "lucide-react";

import { SiteFooter } from "@/components/site/SiteFooter";
import { TeacherNav } from "@/components/teacher/ui/TeacherNav";
import { BRANDING } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { isLocalMode } from "@/lib/localMode";
import { signOut } from "@/lib/firebase";
import { useTeacherAuth } from "@/hooks/useTeacherAuth";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import { useTeacherBootstrap } from "@/hooks/useTeacherBootstrap";
import { useTeacherFeature } from "@/hooks/useTeacherFeature";
import { AiplaHelpCopilot } from "./_AiplaHelpCopilot";

/**
 * Client shell for /teacher/* routes.
 *
 * Handles Firebase auth gate (redirects to /teacher/sign-in when no
 * teacher is signed in) and renders the persistent header + footer.
 * Extracted from layout.tsx so the parent can remain a server component.
 */
export function TeacherClientShell({ children }: { children: ReactNode }) {
  const { user, loading } = useTeacherAuth();
  const isResearcher = useIsResearcher();
  const pathname = usePathname() ?? "";
  // First sign-in (incl. the first after a clean-slate wipe): seed the teacher's
  // onboarding demo. Idempotent backend; reloads once if it just seeded.
  useTeacherBootstrap(!!user);
  // The "AIPLA Hjælp" help co-pilot — opened on demand from the header button
  // (flag-gated), so it never floats over the page's own co-pilot.
  const helpEnabled = useTeacherFeature("aiplaHelp", process.env.NEXT_PUBLIC_AIPLA_HELP);
  const [helpOpen, setHelpOpen] = useState(false);
  // The activity builder (new + edit) is an app-like surface — like the student
  // chat it wants the full width for its two-column config + live preview. The
  // list/insight/settings pages stay capped for comfortable reading lengths.
  const wide = pathname.startsWith("/teacher/activities/");
  const containerMax = wide ? "max-w-none" : "max-w-6xl";

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
        <div className={cn("mx-auto flex items-center justify-between gap-3 px-4 py-3 sm:px-6", containerMax)}>
          <Link
            href="/teacher/classes"
            className="flex items-center gap-2 text-sm font-semibold hover:opacity-80"
            aria-label={`${BRANDING.appName} Teacher — home`}
          >
            {/* Same AIPLA mark the student chat header uses (SkillsBar). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={BRANDING.logo.headerMark}
              alt={BRANDING.appName}
              className="h-7 w-7"
            />
            <span>{BRANDING.appName} Teacher</span>
          </Link>

          <div className="flex items-center gap-3">
            {helpEnabled ? (
              <button
                type="button"
                onClick={() => setHelpOpen((o) => !o)}
                aria-expanded={helpOpen}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Hjælp</span>
              </button>
            ) : null}
            {isLocalMode() ? (
              <div
                role="status"
                aria-label="Local mode banner"
                className="hidden rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 sm:block dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
              >
                LOCAL_MODE
              </div>
            ) : null}
            {isResearcher ? (
              <div
                role="status"
                aria-label="Researcher role active"
                title="Researcher role — cross-class read access across every teacher"
                className="flex items-center gap-1 rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-900 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
              >
                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Researcher</span>
              </div>
            ) : null}
            <div
              // `text-foreground` rather than `text-primary`: brand-coloured
              // TEXT on a low-alpha tint cannot clear WCAG AA on the dark
              // background at any brand lightness that also works as a button
              // fill. The tint carries the brand; the glyph stays legible.
              className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-foreground"
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

      <div className={cn("mx-auto flex w-full flex-1 px-4 sm:px-6", containerMax)}>
        <TeacherNav />
        {/* pb-24 on mobile clears the fixed bottom nav bar; reset at md. */}
        <div className="flex min-w-0 flex-1 flex-col md:pl-6">
          <main className="flex-1 py-6 pb-24 sm:py-8 md:pb-8">{children}</main>
          <SiteFooter />
        </div>
      </div>
      {/* Help co-pilot — opened from the header "Hjælp" button, closed by
          default so it never collides with a page's own co-pilot. Opens
          bottom-left (work co-pilots are bottom-right). */}
      {helpEnabled && helpOpen ? <AiplaHelpCopilot onClose={() => setHelpOpen(false)} /> : null}
    </div>
  );
}
