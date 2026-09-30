/**
 * Client environment beacon — the screen-size slice of 1.1.96 M0 (2026-09-30).
 *
 * The question it answers: "the UI was a bit cramped on a laptop — what screen
 * sizes are people using?". Client errors are too rare to sample screens from,
 * so this sends ONE small report per page session, and again only when a resize
 * moves the viewport into a different width bucket. Read the result with
 * `make screen-sizes ENV=prod`.
 *
 * Design: docs/design/aipla/v1.1.0-feedback/teacher-ui-friction-telemetry.md
 *
 * ## Privacy (ADR-001)
 *
 * A screen size is fine; a fingerprint is not. The payload is coarse numbers,
 * a pointer type, a three-valued surface and the build id the error report
 * already carries. **No user agent, no path, no uid, no group code** — and the
 * backend drops those even if a future client sends them.
 *
 * ## Auth
 *
 * Bare `fetch` to the unauthenticated client-error endpoint, for the same
 * reasons as `clientErrorReporting.ts`: this belongs to no surface, and a
 * student's group token must never be needed to say how wide their screen is.
 */

import { CLIENT_ERROR_ENDPOINT } from "@/lib/clientErrorReporting";
import { isLocalMode } from "@/lib/localMode";
import { clientBuildId } from "@/lib/staleDeployReload";

export type ClientSurface = "student" | "teacher" | "public";

/**
 * Inclusive lower bounds of the width buckets. Kept in lockstep with
 * `VIEWPORT_BUCKETS` in `backend/observability/client_error.py` and
 * `scripts/screen-sizes.sh`.
 */
export const VIEWPORT_BUCKETS = [0, 768, 1280, 1440, 1920] as const;

/** A resize storm settles before we look at it. */
export const RESIZE_DEBOUNCE_MS = 1000;

const STUDENT_PREFIXES = ["/lessons", "/chat", "/group"];

function hasPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Which surface a path belongs to, from its route prefix alone. */
export function surfaceFromPath(path: string): ClientSurface {
  if (hasPrefix(path, "/teacher")) return "teacher";
  if (STUDENT_PREFIXES.some((p) => hasPrefix(path, p))) return "student";
  return "public";
}

/** Index of the width bucket `width` falls in. */
export function viewportBucket(width: number): number {
  let idx = 0;
  VIEWPORT_BUCKETS.forEach((lower, i) => {
    if (width >= lower) idx = i;
  });
  return idx;
}

export interface ClientEnvPayload {
  kind: "env";
  viewportW: number;
  viewportH: number;
  screenW: number;
  screenH: number;
  dpr: number;
  pointer: "coarse" | "fine";
  surface: ClientSurface;
  buildId: string | null;
}

/** Snapshot the environment. Exported for tests; carries nothing else. */
export function readClientEnv(): ClientEnvPayload {
  let coarse = false;
  try {
    coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    // Not worth losing the report over.
  }
  return {
    kind: "env",
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    screenW: window.screen?.width ?? 0,
    screenH: window.screen?.height ?? 0,
    dpr: window.devicePixelRatio || 1,
    pointer: coarse ? "coarse" : "fine",
    surface: surfaceFromPath(window.location.pathname),
    buildId: clientBuildId(),
  };
}

// Per page load: a full navigation gets a fresh module, which is the "page
// session". A client-side route change keeps it, so the beacon is not re-sent.
let lastBucket: number | null = null;
let stopped = false;

/** Test-only: forget this page load's state. */
export function resetClientEnvBeaconForTests(): void {
  lastBucket = null;
  stopped = false;
}

/** Send one beacon if the viewport is in a bucket not yet reported. Never throws. */
export function sendClientEnvIfNewBucket(): void {
  try {
    if (typeof window === "undefined" || isLocalMode() || stopped) return;
    const env = readClientEnv();
    const bucket = viewportBucket(env.viewportW);
    if (bucket === lastBucket) return;
    lastBucket = bucket;
    void fetch(CLIENT_ERROR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify(env),
    })
      .then((resp) => {
        if (!resp.ok) stopped = true; // 429: stop for this page, honestly
      })
      .catch(() => {});
  } catch {
    // Telemetry never breaks the page.
  }
}

/**
 * Report now, then on debounced resizes that cross a bucket. Returns the
 * cleanup. Deferred to idle so it can never compete with first render.
 */
export function startClientEnvBeacon(): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: number | undefined;
  const onResize = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(sendClientEnvIfNewBucket, RESIZE_DEBOUNCE_MS);
  };
  const initial = window.setTimeout(sendClientEnvIfNewBucket, 0);
  window.addEventListener("resize", onResize);
  return () => {
    window.clearTimeout(initial);
    window.clearTimeout(timer);
    window.removeEventListener("resize", onResize);
  };
}
