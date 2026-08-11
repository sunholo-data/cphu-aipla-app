"use client";

/**
 * Group-join page — sprint 2.11 M3.
 *
 * Single input + Join button. Anonymous flow:
 *   1. User pastes the short code their teacher handed out.
 *   2. We POST `/api/proxy/api/auth/group/join`; on success we redirect
 *      to `/`. On failure we render the typed error inline so the user
 *      can retry without losing their typing.
 *
 * Renders only when `NEXT_PUBLIC_AUTH_MODE=anonymous_group_id` is set.
 * Outside that mode the route still exists but tells the user this
 * deployment doesn't use anonymous-group auth (so a stray bookmark or
 * shared URL doesn't 404 — friendlier surface).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppFooter } from "@/components/AppFooter";
import { useAnonymousGroupAuth } from "@/contexts/AnonymousGroupAuthProvider";
import { useEnvironment } from "@/hooks/useEnvironment";
import { isAnonymousGroupAuthMode } from "@/lib/anonymousGroupAuth";
import { environmentLabel } from "@/lib/environment";
import { isLocalMode } from "@/lib/localMode";

// LOCAL_MODE convenience: the seeded group code from
// backend/db/local_fixture.py. Showing it inline saves the
// "what was the code again?" friction on every dev cycle.
// Production builds drop this entire block (isLocalMode() === false).
const LOCAL_MODE_CODE = "local-demo";

export default function GroupJoinPage() {
  if (!isAnonymousGroupAuthMode()) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-2xl font-semibold">Group join not available</h1>
        <p className="text-sm text-muted-foreground">
          This deployment doesn&apos;t use anonymous group-ID auth. Try the
          regular sign-in flow on the home page.
        </p>
        <Link className="text-sm underline" href="/">
          Go home
        </Link>
      </main>
    );
  }
  return <GroupJoinForm />;
}

// 1.B (2026-05-26) — after a successful group join, send the user to
// /lessons (the lesson picker) instead of a hardcoded chat URL. The
// picker fetches GET /api/skills and renders one card per accessible
// skill — same component for anon-group, class-bound, and teacher
// auth modes. Replaces the v0.1 NEXT_PUBLIC_POST_JOIN_REDIRECT env
// var, which hard-locked the system to one skill per deploy.

function GroupJoinForm() {
  const { status, error, join } = useAnonymousGroupAuth();
  const router = useRouter();
  const [code, setCode] = useState("");

  // Prefill from `?code=` so the teacher can hand out a whole join LINK
  // instead of a bare code. The link carries the environment with it, which
  // a code on a whiteboard cannot — the 2026-08-04 dev-code-on-test incident.
  // Read from window rather than useSearchParams(): this page is statically
  // rendered, and useSearchParams() would force a Suspense/CSR bail-out.
  // Prefill only, never auto-join — the student still presses the button.
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("code");
    if (fromLink) setCode(fromLink.trim().toLowerCase());
  }, []);

  useEffect(() => {
    if (status === "joined") {
      router.replace("/lessons");
    }
  }, [status, router]);

  const isJoining = status === "joining";

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    try {
      await join(code);
    } catch {
      // Provider already set `error` — render below.
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          Tilslut din gruppe
          <span className="block text-base font-normal text-muted-foreground">
            Join your group
          </span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Din lærer har givet dig en kort kode (ligner{" "}
          <code className="rounded bg-muted px-1 py-0.5">bright-fox-42</code>).
          Skriv den her for at starte.
        </p>
        <p className="text-xs text-muted-foreground opacity-70">
          (Your teacher gave you a short code — type it below to start.)
        </p>
      </header>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            Gruppekode <span className="text-xs text-muted-foreground">(Group code)</span>
          </span>
          <input
            type="text"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isJoining}
            placeholder="bright-fox-42"
            className="rounded border px-3 py-2 font-mono lowercase"
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "group-error" : undefined}
          />
        </label>

        {isLocalMode() ? (
          <div className="flex items-center justify-between rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <span>
              LOCAL_MODE — seeded code:{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono dark:bg-amber-900">
                {LOCAL_MODE_CODE}
              </code>
            </span>
            <button
              type="button"
              onClick={() => setCode(LOCAL_MODE_CODE)}
              disabled={isJoining}
              className="rounded border border-amber-400 px-2 py-0.5 font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-600 dark:hover:bg-amber-900"
            >
              Use it
            </button>
          </div>
        ) : null}

        {error && <ErrorBlock error={error} />}

        <button
          type="submit"
          disabled={!code.trim() || isJoining}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {isJoining ? "Tilslutter… / Joining…" : "Tilslut / Join"}
        </button>
      </form>

      <p className="text-xs text-muted-foreground">
        Hvis du lukker fanen og kommer tilbage senere, skal du bare skrive
        koden igen — den er gyldig i 30 dage. Glemt koden? Spørg din lærer.
        <br />
        <span className="opacity-70">
          (If you close this tab and come back later, just paste the same code
          again — it&apos;s valid for 30 days. Lost the code? Ask your teacher.)
        </span>
      </p>

      <p className="text-xs text-muted-foreground">
        <Link
          href="/guides"
          className="font-medium underline underline-offset-4 hover:text-foreground"
        >
          Sådan virker det / How it works
        </Link>
      </p>

      <p className="border-t border-border pt-4 text-xs text-muted-foreground">
        Er du lærer?{" "}
        <Link
          href="/teacher/sign-in"
          className="font-medium underline underline-offset-4 hover:text-foreground"
        >
          Log ind her
        </Link>
        <span className="opacity-70"> / Are you a teacher? Sign in here.</span>
      </p>

      <AppFooter />
    </main>
  );
}

function ErrorBlock({
  error,
}: {
  error: NonNullable<ReturnType<typeof useAnonymousGroupAuth>["error"]>;
}) {
  let body: string;
  switch (error.kind) {
    case "rate_limited":
      body = `Too many tries. Try again in ${error.retryAfterSeconds}s.`;
      break;
    case "at_capacity":
      body = "This group is at capacity for today. Try again tomorrow or ask your teacher.";
      break;
    case "unknown_or_revoked":
      body = "Code not found, expired, or revoked. Ask your teacher for a fresh code.";
      break;
    case "network":
    default:
      body = `Couldn't reach the server. ${error.message}`;
  }
  return (
    <div id="group-error" role="alert" className="flex flex-col gap-1.5">
      <p className="text-sm text-destructive">{body}</p>
      {error.kind === "unknown_or_revoked" && <WrongSiteHint />}
    </div>
  );
}

/**
 * The "code not found" answer is indistinguishable, from the student's side,
 * between a revoked code and a code from a DIFFERENT AIPLA deployment — group
 * codes live in each environment's own Firestore, and the three sites differ
 * only by an opaque hostname. That second case cost a teacher two hours on
 * 2026-08-04, so name the site they are actually on and let them compare.
 */
function WrongSiteHint() {
  const info = useEnvironment();
  const [host, setHost] = useState("");

  useEffect(() => setHost(window.location.host), []);

  // Nothing to compare against if the backend didn't answer; and LOCAL_MODE
  // has exactly one site, so there is no mix-up to warn about.
  if (!info || info.env === "local") return null;

  const where = environmentLabel(info.env).tag;

  return (
    <p className="rounded border border-border bg-muted px-2 py-1.5 text-xs text-muted-foreground">
      Koder virker kun på den udgave af siden, de er lavet på. Du er på{" "}
      <strong>{where}</strong> ({host}). Tjek med din lærer, at det er den
      rigtige adresse.
      <br />
      <span className="opacity-70">
        (Codes only work on the site they were created on. You are on {where} (
        {host}). Check the address with your teacher.)
      </span>
    </p>
  );
}

