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

import { useAnonymousGroupAuth } from "@/contexts/AnonymousGroupAuthProvider";
import { useEnvironment } from "@/hooks/useEnvironment";
import { isAnonymousGroupAuthMode, PREVIEW_CODE_PREFIX, safePreviewNext } from "@/lib/anonymousGroupAuth";
import { environmentLabel } from "@/lib/environment";
import { isLocalMode } from "@/lib/localMode";
import { LanguageSwitch } from "@/components/site/LanguageSwitch";
import { useT } from "@/i18n";

// 1.1.108 — the join page renders before any class or activity is known, so it
// speaks the PERSON's language: their DA | EN choice, remembered in this
// browser, else the site default. The switch sits at the top of the form so a
// student who cannot read the default finds theirs before typing a code.
const EXAMPLE_CODE = "bright-fox-42";

// LOCAL_MODE convenience: the seeded group code from
// backend/db/local_fixture.py. Showing it inline saves the
// "what was the code again?" friction on every dev cycle.
// Production builds drop this entire block (isLocalMode() === false).
const LOCAL_MODE_CODE = "local-demo";

export default function GroupJoinPage() {
  // locale: en-only, by decision 1.1.108 — reached only on a deployment without
  // anonymous group auth, i.e. by a developer, never by a student.
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
  // 1.1.133 — where a teacher's "Try as student" join lands (validated).
  const [nextPath, setNextPath] = useState<string | null>(null);

  // Prefill from `?code=` so the teacher can hand out a whole join LINK
  // instead of a bare code. The link carries the environment with it, which
  // a code on a whiteboard cannot — the 2026-08-04 dev-code-on-test incident.
  // Read from window rather than useSearchParams(): this page is statically
  // rendered, and useSearchParams() would force a Suspense/CSR bail-out.
  // Prefill only, never auto-join — the student still presses the button.
  //
  // The ONE exception (1.1.133): a `preview-` code, which only the builder's
  // "Try as student" button mints, for the teacher who clicked it. That teacher
  // asked for the student view, not a join form, so it joins at once and lands
  // in the activity. A real class code is never auto-joined.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get("code");
    if (!fromLink) return;
    const prefilled = fromLink.trim().toLowerCase();
    setCode(prefilled);
    if (prefilled.startsWith(PREVIEW_CODE_PREFIX)) {
      setNextPath(safePreviewNext(params.get("next")));
      join(prefilled).catch(() => {
        /* Provider already set `error` — the form renders it. */
      });
    }
    // Mount-only: `join` is stable for the provider's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === "joined") {
      router.replace(nextPath ?? "/lessons");
    }
  }, [status, router, nextPath]);

  const isJoining = status === "joining";
  const t = useT("JoinPage");
  const codeTag = (chunks: React.ReactNode) => <code className="rounded bg-muted px-1 py-0.5">{chunks}</code>;
  const teacherLink = (chunks: React.ReactNode) => (
    <Link href="/teacher/sign-in" className="font-medium underline underline-offset-4 hover:text-foreground">
      {chunks}
    </Link>
  );

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
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t.rich("intro", { example: EXAMPLE_CODE, code: codeTag })}</p>
      </header>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            {t("codeLabel")}
          </span>
          <input
            type="text"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isJoining}
            placeholder={EXAMPLE_CODE}
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

        {error && (
          <ErrorBlock
            error={error}
            disabled={isJoining}
            onAcceptSuggestion={(suggested) => {
              // 1.1.151 F4 — the student CONFIRMED the suggestion; only now join.
              setCode(suggested);
              join(suggested).catch(() => {
                /* Provider already set `error` — the form renders it. */
              });
            }}
          />
        )}

        <button
          type="submit"
          disabled={!code.trim() || isJoining}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {isJoining ? t("joining") : t("join")}
        </button>
      </form>

      <p className="text-xs text-muted-foreground">
        {t("comeBack")}
      </p>

      <p className="text-xs text-muted-foreground">
        <Link
          href="/guides"
          className="font-medium underline underline-offset-4 hover:text-foreground"
        >
          {t("howItWorks")}
        </Link>
      </p>

      <p className="border-t border-border pt-4 text-xs text-muted-foreground">
        {t.rich("teacher", { link: teacherLink })}
      </p>
    </main>
  );
}

function ErrorBlock({
  error,
  disabled,
  onAcceptSuggestion,
}: {
  error: NonNullable<ReturnType<typeof useAnonymousGroupAuth>["error"]>;
  disabled?: boolean;
  onAcceptSuggestion?: (code: string) => void;
}) {
  const t = useT("JoinPage");
  const body = (): string => {
    switch (error.kind) {
      case "rate_limited":
        return t("rateLimited", { seconds: error.retryAfterSeconds });
      case "at_capacity":
        return t("atCapacity");
      case "unknown_or_revoked":
        return t("unknownCode");
      case "network":
      default:
        return t("network", { detail: error.message });
    }
  };
  return (
    <div id="group-error" role="alert" className="flex flex-col gap-1.5">
      {error.kind === "unknown_or_revoked" && error.suggestion ? (
        // 1.1.151 F4 — one deterministic typo fix the server confirmed is live.
        // A question, not an answer: a near-miss could be another class's code.
        <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-muted/40 px-3 py-2 text-sm">
          <span>
            {t.rich("didYouMean", {
              code: error.suggestion,
              strong: (chunks) => <strong className="font-mono">{chunks}</strong>,
            })}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAcceptSuggestion?.(error.suggestion as string)}
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          >
            {t("yesJoin")}
          </button>
        </div>
      ) : (
        <p className="text-sm text-destructive">
          {body()}
        </p>
      )}
      {error.kind === "unknown_or_revoked" && !error.suggestion && <WrongSiteHint />}
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
  const t = useT("JoinPage");
  const [host, setHost] = useState("");

  useEffect(() => setHost(window.location.host), []);

  // Nothing to compare against if the backend didn't answer; and LOCAL_MODE
  // has exactly one site, so there is no mix-up to warn about.
  if (!info || info.env === "local") return null;

  const where = environmentLabel(info.env).tag;
  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

  return (
    <p className="rounded border border-border bg-muted px-2 py-1.5 text-xs text-muted-foreground">
      {t.rich("wrongSite", { where, host, strong })}
    </p>
  );
}

