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

/**
 * Reload once if `error` looks like a stale deploy and the cooldown allows it.
 * Returns whether a reload was started.
 */
export function reloadIfStaleDeploy(
  error: unknown,
  { chunkLoadOnly = false }: { chunkLoadOnly?: boolean } = {},
): boolean {
  if (typeof window === "undefined") return false;
  const stale = chunkLoadOnly ? isChunkLoadFailure(error) : isStaleDeployError(error);
  if (!stale || !canAutoReload()) return false;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
