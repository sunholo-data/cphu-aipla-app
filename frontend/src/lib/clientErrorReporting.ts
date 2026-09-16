/**
 * Client error reporting (1.1.96 M-1).
 *
 * Until this shipped, **a JavaScript exception in a teacher's browser was
 * invisible to us**: no Sentry, no PostHog, no global error boundary, no
 * `window.onerror`, no `unhandledrejection` handler. The backend is well
 * instrumented; the client had nothing. So "the UI is difficult" could only ever
 * be answered with a guess — and part of "difficult" may simply be errors nobody
 * can see.
 *
 * Design: docs/design/aipla/v1.1.0-feedback/teacher-ui-friction-telemetry.md (M-1)
 * Sprint: docs/design/aipla/v1.1.0-feedback/client-error-reporting-sprint.md (S2)
 *
 * ## Why bare `fetch` and not `fetchWithAuth` / `fetchWithTeacherAuth`
 *
 * **Do not "fix" this to use an auth helper.** Both helpers mint a token, both
 * can themselves throw, and the eslint surface fences exist to stop the wrong one
 * being used on the wrong surface — but a *global* error reporter belongs to no
 * surface. More importantly, an error reporter behind a token cannot report the
 * errors that matter most: a throw during auth bootstrap, a crash on a public
 * page, or a failure of the token mint itself. The backend endpoint takes no auth
 * for exactly this reason and is rate-limited instead.
 *
 * ## Privacy
 *
 * No identity is sent. Not a uid, not an email, not a group code — the request
 * body has no field for one. Only `location.pathname` (never the query string:
 * a join link is `…/group?code=XXXX`), a three-valued `role` hint that identifies
 * nobody, and a redacted message + stack. This is why M-1 needs no consent
 * decision where M0's friction events will.
 *
 * ## Self-limiting
 *
 * A render loop must not turn one bug into unbounded log spend, so: dedupe by
 * fingerprint, at most `MAX_REPORTS_PER_PAGE` per page load, and a permanent stop
 * for the page on any non-2xx (the backend's 429 is a real signal, not noise).
 */

import { ANON_GROUP_TOKEN_STORAGE_KEY } from "@/lib/anonymousGroupAuth";
import { isLocalMode } from "@/lib/localMode";

export const CLIENT_ERROR_ENDPOINT = "/api/proxy/api/client-errors";

/** What produced the error. Mirrors the backend's closed enum. */
export type ClientErrorKind = "render" | "window.onerror" | "unhandledrejection";

/** Who was looking at it. Three-valued; identifies nobody. */
export type ClientErrorRole = "teacher" | "student" | "anon";

/** Matches `MAX_MESSAGE_CHARS` / `MAX_STACK_CHARS` in `observability/client_error.py`. */
const MAX_MESSAGE_CHARS = 500;
const MAX_STACK_CHARS = 4000;

/** One bug in a render loop is one bug, not a thousand reports. */
export const MAX_REPORTS_PER_PAGE = 10;

const REDACTED = "[redacted]";

/**
 * Ordered: the JWT pattern runs before the generic bearer one so a
 * `Bearer eyJ…` collapses to a single marker rather than a nested pair.
 * Kept in lockstep with `_REDACTIONS` in `backend/observability/client_error.py`,
 * which runs the same pass again as defence in depth.
 */
const REDACTIONS: [RegExp, string][] = [
  // A JWT — the anonymous group token and the Firebase teacher token both look
  // like this, and either can end up quoted in an exception message.
  [/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED],
  [/[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}/g, `Bearer ${REDACTED}`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED],
  // A query string anywhere in the text — this is what keeps live class join
  // codes out of the log when a stack frame quotes a URL. Requires a `key=` so
  // it matches an actual query string: a bare `?` is ordinary prose ("what
  // happened?") and redacting it only mangles the message we want to read.
  [/\?[A-Za-z0-9_\-%.+[\]]*=[^\s]*/g, `?${REDACTED}`],
];

/** Strip credentials, email addresses and query strings from free text. */
export function redact(text: string): string {
  if (!text) return "";
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

// Per page load, not per module import in the abstract: a full navigation gets a
// fresh module instance, which is exactly the window we want to cap.
const seen = new Set<string>();
let sent = 0;
let stopped = false;

/** Test-only: forget this page load's dedupe + cap state. */
export function resetClientErrorReportingForTests(): void {
  seen.clear();
  sent = 0;
  stopped = false;
}

/**
 * Best-effort role hint.
 *
 * Deliberately does NOT touch Firebase: `auth().currentUser` resolves
 * asynchronously and the auth layer may itself be the thing that just broke. A
 * stored group session is a synchronous, reliable "this is a student"; the
 * `/teacher` prefix is a reliable "this is a teacher surface". Anything else is
 * honestly `anon` rather than a guess.
 */
function detectRole(): ClientErrorRole {
  try {
    if (window.sessionStorage.getItem(ANON_GROUP_TOKEN_STORAGE_KEY)) return "student";
  } catch {
    // Storage can throw in a locked-down browser. Not a reason to lose the report.
  }
  return window.location.pathname.startsWith("/teacher") ? "teacher" : "anon";
}

/** `kind` + message + the first stack frame: the same bug twice is one report. */
function fingerprint(kind: string, message: string, stack: string): string {
  return `${kind}|${message}|${stack.split("\n")[0] ?? ""}`;
}

export interface ClientErrorReport {
  kind: ClientErrorKind;
  message: string;
  stack?: string;
  /** React's component stack, when the caller is an error boundary. */
  componentStack?: string;
}

/**
 * Report one client-side error. Best-effort and **never throws** — a throw
 * inside the error reporter is the worst bug this file could have.
 */
export function reportClientError({ kind, message, stack = "", componentStack = "" }: ClientErrorReport): void {
  try {
    if (typeof window === "undefined") return; // SSR
    if (isLocalMode()) return;
    if (stopped || sent >= MAX_REPORTS_PER_PAGE) return;

    const safeMessage = redact(String(message ?? "")).slice(0, MAX_MESSAGE_CHARS);
    // The component stack is appended rather than sent separately: it is the
    // most useful part of a render error and the backend has one stack field.
    const rawStack = componentStack ? `${stack}\n--- component stack ---\n${componentStack}` : stack;
    const safeStack = redact(String(rawStack ?? "")).slice(0, MAX_STACK_CHARS);

    const key = fingerprint(kind, safeMessage, safeStack);
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;

    void fetch(CLIENT_ERROR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Survives the navigation that a fatal error often triggers.
      keepalive: true,
      body: JSON.stringify({
        kind,
        message: safeMessage,
        stack: safeStack,
        // Path only. Never `location.href` — the query string is the single
        // highest-risk field the browser could send.
        url: window.location.pathname,
        role: detectRole(),
      }),
    })
      .then((resp) => {
        // 429 from the per-IP limiter, or anything else non-2xx: stop for this
        // page. The backend answers honestly rather than reassuringly, so a
        // rejection here means the report was genuinely dropped.
        if (!resp.ok) stopped = true;
      })
      .catch(() => {
        // Offline, or the backend is the thing that is down. Nothing to do — and
        // definitely nothing to throw.
      });
  } catch {
    // Unreachable by design; here so this function's contract is total.
  }
}
