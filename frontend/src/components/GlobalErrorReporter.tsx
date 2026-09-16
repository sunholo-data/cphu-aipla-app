"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/clientErrorReporting";

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
      reportClientError({
        kind: "unhandledrejection",
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? (reason.stack ?? "") : "",
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
