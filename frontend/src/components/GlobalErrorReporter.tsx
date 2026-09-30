"use client";

import { useEffect } from "react";

import { startClientEnvBeacon } from "@/lib/clientEnvBeacon";
import { reportClientError } from "@/lib/clientErrorReporting";
import {
  RECOVERY_SETTLE_MS,
  reloadIfStaleDeploy,
  shouldAutoReload,
  takePendingReload,
} from "@/lib/staleDeployReload";

/**
 * Installs the two window-level error listeners (1.1.96 M-1). Renders nothing.
 *
 * Mounted once in the root layout. React's error boundaries (`app/error.tsx`,
 * `app/global-error.tsx`) catch **render** throws and nothing else — in
 * production React swallows those into the boundary and `window.onerror` never
 * fires. These two listeners catch the disjoint remainder:
 *
 * - `error`               — throws in event handlers, timers, and non-React code
 * - `unhandledrejection`  — a rejected promise nobody awaited, which is the shape
 *                           of every failed `fetch` in this codebase
 *
 * All three sources are needed; any one alone leaves a hole.
 */
export function GlobalErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientError({
        kind: "window.onerror",
        // `event.error` is absent for cross-origin script errors ("Script
        // error."), where `event.message` is all the browser will give us.
        message: event.error?.message || event.message || "unknown error",
        stack: event.error?.stack || "",
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason: unknown = event.reason;
      // A lazy import whose chunk vanished in a deploy. Chunk-load failures
      // only: the page may still be usable, so nothing looser justifies
      // throwing away what is on it. Decided before reporting so the report
      // can say whether it reloaded (1.1.138 M0).
      const autoReloaded = shouldAutoReload(reason, { chunkLoadOnly: true });
      reportClientError({
        kind: "unhandledrejection",
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? (reason.stack ?? "") : "",
        autoReloaded,
      });
      if (autoReloaded) reloadIfStaleDeploy(reason, { chunkLoadOnly: true });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // 1.1.138 M0 — if this page load is the product of an automatic
    // stale-deploy reload and it renders for RECOVERY_SETTLE_MS without an
    // error boundary claiming the marker, say so. This component lives in the
    // root layout, so it mounts on every page — including one whose segment
    // then crashes into app/error.tsx; that boundary takes the marker first,
    // which is why this waits instead of reporting on mount.
    const recoveryTimer = window.setTimeout(() => {
      const pending = takePendingReload();
      if (!pending) return;
      reportClientError({
        kind: "recovered",
        message: "page rendered after an automatic stale-deploy reload",
        afterAutoReload: true,
        previousBuildId: pending.fromBuildId,
      });
    }, RECOVERY_SETTLE_MS);

    // Screen-size slice of M0 (2026-09-30): one environment beacon per page
    // session, again only when a resize crosses a width bucket.
    const stopEnvBeacon = startClientEnvBeacon();

    return () => {
      stopEnvBeacon();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.clearTimeout(recoveryTimer);
    };
  }, []);

  return null;
}
