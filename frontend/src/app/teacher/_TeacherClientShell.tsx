"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { SiteFooter } from "@/components/site/SiteFooter";
import { PageLoading } from "@/components/ui/skeleton";
import { AskAiplaButton, CopilotEntryProvider, CopilotLauncherClearance } from "@/components/teacher/copilot";
import { AccountMenu } from "@/components/teacher/ui/AccountMenu";
import { TeacherNav } from "@/components/teacher/ui/TeacherNav";
import { VisitorAccessBanner } from "@/components/teacher/VisitorAccessBanner";
import { PrivacyNoticeGate } from "@/components/teacher/PrivacyNoticeGate";
import { BRANDING } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { isLocalMode } from "@/lib/localMode";
import { signOut } from "@/lib/firebase";
import { useTeacherAuth } from "@/hooks/useTeacherAuth";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import { useIsProgrammeAdmin } from "@/hooks/useIsProgrammeAdmin";
import { useTeacherBootstrap } from "@/hooks/useTeacherBootstrap";
import { useTeacherFeature } from "@/hooks/useTeacherFeature";
import { AiplaHelpCopilot } from "./_AiplaHelpCopilot";
import { useT } from "@/i18n";

/**
 * Client shell for /teacher/* routes.
 *
 * Handles Firebase auth gate (redirects to /teacher/sign-in when no
 * teacher is signed in) and renders the persistent header + footer.
 * Extracted from layout.tsx so the parent can remain a server component.
 */
export function TeacherClientShell({ children }: { children: ReactNode }) {
  const { user, loading } = useTeacherAuth();
  const t = useT("TeacherClientShell");
  const isResearcher = useIsResearcher();
  const isProgrammeAdmin = useIsProgrammeAdmin();
  const pathname = usePathname() ?? "";
  // First sign-in (incl. the first after a clean-slate wipe): seed the teacher's
  // onboarding demo. Idempotent backend; reloads once if it just seeded.
  useTeacherBootstrap(!!user);
  // The "AIPLA Hjælp" help co-pilot — opened on demand from the header button
  // (flag-gated), so it never floats over the page's own co-pilot.
  const helpEnabled = useTeacherFeature("aiplaHelp", process.env.NEXT_PUBLIC_AIPLA_HELP);
  const [helpOpen, setHelpOpen] = useState(false);
  // Google avatar URLs can fail (revoked photo, hotlink refusal). Fall back to
  // the initials rather than leaving a broken image in the header.
  const [avatarFailed, setAvatarFailed] = useState(false);
  // The activity builder (new + edit) is an app-like surface — like the student
  // chat it wants the full width for its two-column config + live preview. The
  // list/insight/settings pages stay capped for comfortable reading lengths.
  // The Sim workshop is the same kind of surface: a sim designed for ~700 px
  // beside its assistant.
  const wide = pathname.startsWith("/teacher/activities/") || pathname.startsWith("/teacher/sims");
  const containerMax = wide ? "max-w-none" : "max-w-6xl";
  // The new-activity wizard (2026-11-12) is a focused, stepped flow with its
  // own sticky footer: no section nav beside it (or, on a phone, fixed over
  // that footer). Cancel and the header mark lead out.
  const focused = pathname.replace(/\/$/, "") === "/teacher/activities/new";

  // Show a minimal loading state while Firebase auth resolves.
  // useTeacherAuth will redirect to /teacher/sign-in if auth fails —
  // keep this node mounted until that redirect fires.
  if (loading) {
    return (
      <main className="min-h-screen">
        <PageLoading />
      </main>
    );
  }

  // After loading: if there's no user and we're not in LOCAL_MODE, the
  // redirect to /teacher/sign-in is in flight from useTeacherAuth.
  // Render children bare (no header) so the sign-in page itself is visible.
  if (!user && !isLocalMode()) return <>{children}</>;

  const account = user as
    | { displayName?: string | null; email?: string | null; photoURL?: string | null }
    | null;
  const displayName = account?.displayName ?? t("teacherFallback");
  const photoURL = account?.photoURL ?? null;
  // The EMAIL leads, because it is the only part of the identity that is unique
  // per account. Two accounts belonging to the same person share a display name
  // and therefore share their initials — which is exactly how a session in the
  // wrong account goes unnoticed (2026-08-18: a whole prod investigation ran on
  // the wrong one). The name is the fallback, not the headline.
  const accountLabel = account?.email || displayName;
  const initials = displayName
    .split(" ")
    .map((w: string) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase() || "T";

  return (
    // 1.1.125 M3 — the provider a page's work copilot registers with, so the
    // header's one button knows what this page offers.
    <CopilotEntryProvider>
    <div className="flex min-h-screen flex-col">
      {/* UI sweep 2026-11-11 — the first focusable element on every teacher
          page, so a keyboard user skips the banners, header and nav. */}
      <a
        href="#teacher-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline focus:outline-2 focus:outline-ring"
      >
        {t("skipToMain")}
      </a>
      {/* ACCESS-1 M4: renders nothing for a pilot teacher; above the header so
          it is the first thing a visitor reads, and never covers the nav. */}
      <VisitorAccessBanner />
      {/* KU legal, 2026-10-05 — shown until this teacher acknowledges the
          current notice; renders nothing afterwards (and on a read failure). */}
      <PrivacyNoticeGate />
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className={cn("mx-auto flex items-center justify-between gap-3 px-4 py-3 sm:px-6", containerMax)}>
          <Link
            href="/teacher/classes"
            className="flex items-center gap-2 text-sm font-semibold hover:opacity-80"
            aria-label={t("homeLabel", { app: BRANDING.appName })}
          >
            {/* Same AIPLA mark the student chat header uses (SkillsBar). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={BRANDING.logo.headerMark}
              alt={BRANDING.appName}
              className="h-7 w-7"
            />
            <span>{t("brand", { app: BRANDING.appName })}</span>
          </Link>

          <div className="flex items-center gap-3">
            {/* The one "Hjælp" menu (UI sweep 2026-11-11): guides, the help
                assistant (flag) and the page's work copilot (1.1.125 M3). */}
            <AskAiplaButton helpEnabled={helpEnabled} onOpenHelp={() => setHelpOpen(true)} />
            {isLocalMode() ? (
              <div
                role="status"
                aria-label={t("localMode")}
                className="hidden rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 sm:block dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
              >
                LOCAL_MODE
              </div>
            ) : null}
            {/* 1.1.125 M0 — Settings, Tutors and Sign out live behind the
                account, not in the nav: a nav slot is for the places a teacher
                goes every session. The researcher role is a line in this menu
                (and a marker on its trigger) since the UI sweep — the header
                "Forsker" pill went. */}
            <AccountMenu
              label={accountLabel}
              isResearcher={isResearcher}
              isProgrammeAdmin={isProgrammeAdmin}
              onSignOut={() => void signOut()}
              avatar={
                photoURL && !avatarFailed ? (
                  /* The Google account photo. Decorative (alt="") — the email
                     beside it is the accessible identity. `no-referrer` because
                     lh3.googleusercontent.com refuses some cross-origin
                     referrers and answers 403. */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={photoURL}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                    className="h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div
                    // `text-foreground` rather than `text-primary`: brand-coloured
                    // TEXT on a low-alpha tint cannot clear WCAG AA on the dark
                    // background at any brand lightness that also works as a button
                    // fill. The tint carries the brand; the glyph stays legible.
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-foreground"
                  >
                    {initials}
                  </div>
                )
              }
            />
          </div>
        </div>
      </header>

      <div className={cn("mx-auto flex w-full flex-1 px-4 sm:px-6", containerMax)}>
        {focused ? null : <TeacherNav />}
        {/* pb-24 on mobile clears the fixed bottom nav bar; reset at md. */}
        <div className={cn("flex min-w-0 flex-1 flex-col", !focused && "md:pl-6")}>
          <main
            id="teacher-main"
            tabIndex={-1}
            className={cn("flex-1 py-6 outline-none sm:py-8", focused ? "pb-6" : "pb-24 md:pb-8")}
          >
            {children}
          </main>
          <SiteFooter />
          {/* The page's co-pilot pill floats bottom-right; this lets the end
              of every page scroll clear of it. Nothing when no co-pilot. */}
          <CopilotLauncherClearance />
        </div>
      </div>
      {/* Help co-pilot — opened from the header "Hjælp" button, closed by
          default so it never collides with a page's own co-pilot. Opens
          bottom-left (work co-pilots are bottom-right). */}
      {helpEnabled && helpOpen ? <AiplaHelpCopilot onClose={() => setHelpOpen(false)} /> : null}
    </div>
    </CopilotEntryProvider>
  );
}
