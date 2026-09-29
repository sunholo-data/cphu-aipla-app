/**
 * Recover a tab that outlived a deploy.
 *
 * Every deploy renames the JS chunks. A tab loaded before it still holds the old
 * webpack manifest, so the next client-side navigation asks for chunks that no
 * longer exist and the page dies in the error boundary. Prod, 2026-09-23/24:
 * three teacher crashes on `/teacher/classes` and `/teacher/activities/new`
 * reading `can't access property "call", e[o] is undefined` (Firefox) and
 * `Cannot read properties of undefined (reading 'call')` (Chrome) — the missing
 * module-factory lookup inside webpack's `require`.
 *
 * A full reload fetches the new manifest and fixes it. The page has already
 * crashed, so a reload loses nothing the crash had not already lost.
 *
 * Loop guard: at most one automatic reload per `RELOAD_COOLDOWN_MS`. The `call`
 * signature can also be a genuine bug; then the reload happens once, the error
 * comes back, and the boundary is shown as before.
 */

const STORAGE_KEY = "aipla:stale-deploy-reload-at";
export const RELOAD_COOLDOWN_MS = 60_000;

/** A chunk that definitely failed to load. */
const CHUNK_LOAD_PATTERNS: RegExp[] = [
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

/** webpack's `__webpack_modules__[id].call(...)` on a module the old manifest
 *  names and the new build does not ship. Only trusted inside an error
 *  boundary — as a bare TypeError it could be an ordinary bug. */
const MODULE_FACTORY_PATTERNS: RegExp[] = [
  /reading 'call'\)/,
  /property "call", \w+\[\w+\] is undefined/,
];

function messageOf(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
}

export function isChunkLoadFailure(error: unknown): boolean {
  if (!error) return false;
  if ((error as { name?: unknown }).name === "ChunkLoadError") return true;
  const message = messageOf(error);
  return CHUNK_LOAD_PATTERNS.some((p) => p.test(message));
}

/** The wider test, for a render crash in an error boundary. */
export function isStaleDeployError(error: unknown): boolean {
  if (!error) return false;
  if (isChunkLoadFailure(error)) return true;
  const message = messageOf(error);
  return MODULE_FACTORY_PATTERNS.some((p) => p.test(message));
}

/** True when no automatic reload happened within the cooldown. Never throws. */
export function canAutoReload(now: number = Date.now()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(STORAGE_KEY) ?? 0);
    return !last || now - last > RELOAD_COOLDOWN_MS;
  } catch {
    // Storage blocked: without the loop guard, do not reload at all.
    return false;
  }
}

export interface ReloadOptions {
  /** Trust only a definite chunk-load failure (the window listener's test). */
  chunkLoadOnly?: boolean;
}

/**
 * Would `reloadIfStaleDeploy` reload for this error, right now? Pure — no
 * reload, no write. Lets a caller put the answer in its crash report BEFORE the
 * reload starts (1.1.138 M0: `autoReloaded`).
 */
export function shouldAutoReload(error: unknown, { chunkLoadOnly = false }: ReloadOptions = {}): boolean {
  if (typeof window === "undefined") return false;
  const stale = chunkLoadOnly ? isChunkLoadFailure(error) : isStaleDeployError(error);
  return stale && canAutoReload();
}

/**
 * Reload once if `error` looks like a stale deploy and the cooldown allows it.
 * Returns whether a reload was started.
 */
export function reloadIfStaleDeploy(error: unknown, options: ReloadOptions = {}): boolean {
  if (!shouldAutoReload(error, options)) return false;
  try {
    const now = Date.now();
    window.sessionStorage.setItem(STORAGE_KEY, String(now));
    // Tells the NEXT page load that it is the product of an automatic reload,
    // and which build the crashed tab was on (1.1.138 M0). Best effort: a
    // failure here costs the `recovered` report, never the reload.
    try {
      const pending: PendingReload = { at: now, fromBuildId: clientBuildId() };
      window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch {
      // ignore
    }
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1.1.138 M0 — know which crash it was.
//
// The crash report goes out "either way", before the reload, so a successful
// recovery used to be indistinguishable in the log from a crash nobody got out
// of. Four prod crashes on revision 00061 came 1–3 days after its deploy, and
// the log could not say whether those tabs recovered. Three facts settle it:
//   - which build the crashing tab ran            → `buildId` on every report
//   - whether that crash triggered a reload        → `autoReloaded`
//   - whether the reloaded page then rendered      → a `recovered` report,
//     carrying the build it came FROM (`previousBuildId`) beside the build it
//     landed on (`buildId`). Different ids = a real stale deploy that the
//     reload cured. Equal ids = the skew came from somewhere else (the service
//     worker's cached page is the suspect) or it was an ordinary bug.
// The server's own build is not sent: the backend stamps its Cloud Run
// `revision` + `app_version` on every row, which the client cannot misreport.
// ---------------------------------------------------------------------------

const PENDING_KEY = "aipla:stale-deploy-reload-pending";

/** How long a reloaded page must render without crashing to count as recovered. */
export const RECOVERY_SETTLE_MS = 3_000;

export interface PendingReload {
  /** When the reload was started (ms epoch). */
  at: number;
  /** The build the crashed tab was running. */
  fromBuildId: string | null;
}

/** This bundle's build id, inlined at build time by next.config (build-id.mjs). */
export function clientBuildId(): string | null {
  const id = process.env.NEXT_PUBLIC_BUILD_ID;
  return id ? id : null;
}

/**
 * Consume the marker an automatic reload left behind. Returns it when this page
 * load is the product of a reload in the last `RELOAD_COOLDOWN_MS`, else null.
 * One-shot: the first caller takes it — the recovery check if the page settled,
 * an error boundary if it crashed again. Never throws.
 */
export function takePendingReload(now: number = Date.now()): PendingReload | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_KEY);
    const parsed = JSON.parse(raw) as Partial<PendingReload>;
    const at = Number(parsed.at);
    // A marker from a reload whose page never ran (the tab was closed, the
    // network died) must not be claimed by some later, unrelated load.
    if (!Number.isFinite(at) || now - at > RELOAD_COOLDOWN_MS || now < at) return null;
    return {
      at,
      fromBuildId: typeof parsed.fromBuildId === "string" ? parsed.fromBuildId : null,
    };
  } catch {
    return null;
  }
}
