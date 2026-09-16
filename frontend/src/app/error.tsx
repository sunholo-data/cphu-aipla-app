"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/clientErrorReporting";

/**
 * Route-level error boundary (1.1.96 M-1). **Nothing like this existed before**:
 * there was no `error.tsx` and no `global-error.tsx` anywhere under `src/app/`,
 * so a render throw on any route showed Next's bare built-in "Application error:
 * a client-side exception has occurred" — no recovery affordance, and no way for
 * the teacher to tell us what they saw.
 *
 * Two jobs, in this order:
 *   1. Report it. React swallows a render throw into the nearest boundary, so
 *      `window.onerror` never fires for these — without this call they stay
 *      invisible no matter what the window listeners do.
 *   2. Give the person a way out. The audience here is a professional whose
 *      lesson just broke; "try again" and a route home is the minimum.
 *
 * `digest` is Next's server-error hash. It is not a user id and not free text —
 * it is safe to show, and it is the only thing that ties a screenshot to a log.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      kind: "render",
      message: error.message || "render error",
      stack: error.stack ?? "",
    });
  }, [error]);

  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-xl font-semibold text-foreground">Something went wrong on this page</h1>
      <p className="text-sm text-muted-foreground">
        The error has been reported automatically. Trying again often works — the rest of the app is
        unaffected.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90"
        >
          Try again
        </button>
        {/* A button doing a hard `location.assign`, not a `<Link>`: client-side
            routing is precisely what just failed, so a soft navigation can
            re-enter the same broken tree. A full document load discards every
            piece of client state that got us here — which is the point of the
            escape hatch. (It also satisfies `no-html-link-for-pages`, but that
            is a side effect, not the reason.) */}
        <button
          type="button"
          onClick={() => window.location.assign("/")}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Go to the start page
        </button>
      </div>
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          Reference: <code>{error.digest}</code>
        </p>
      )}
    </main>
  );
}
