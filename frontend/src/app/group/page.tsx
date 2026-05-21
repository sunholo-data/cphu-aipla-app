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
import { isAnonymousGroupAuthMode } from "@/lib/anonymousGroupAuth";
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

// AIPLA v0.1 — after a successful group join, send the user directly
// to the single skill the demo exposes. Previously this redirected to
// "/", which under anonymous-group mode shows a "Tilslut din gruppe"
// CTA back to /group → infinite bounce. Customise per fork via
// NEXT_PUBLIC_POST_JOIN_REDIRECT (must be baked into the bundle via
// frontend/Dockerfile ARG, same pattern as NEXT_PUBLIC_AUTH_MODE).
const POST_JOIN_REDIRECT =
  process.env.NEXT_PUBLIC_POST_JOIN_REDIRECT ||
  "/chat/@aitana-platform/problem-set-hints";

function GroupJoinForm() {
  const { status, error, join } = useAnonymousGroupAuth();
  const router = useRouter();
  const [code, setCode] = useState("");

  // When the provider transitions to `joined`, route directly to the
  // demo chat — NOT to "/", which in anonymous-group mode shows a CTA
  // pointing back here and creates a redirect loop.
  useEffect(() => {
    if (status === "joined") {
      router.replace(POST_JOIN_REDIRECT);
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

        {isLocalMode() && (
          // LOCAL_MODE convenience: one-click fill the seeded dev code.
          // Hidden in production builds (isLocalMode() is false).
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
        )}

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
    <p
      id="group-error"
      role="alert"
      className="text-sm text-destructive"
    >
      {body}
    </p>
  );
}
