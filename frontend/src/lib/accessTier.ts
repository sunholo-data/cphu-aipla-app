/**
 * Access tier on the client (ACCESS-1 M1/M4).
 *
 * Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md
 *
 * The client NEVER decides eligibility — the backend does, from a signed custom
 * claim, and says so with a 402. This module's whole job is to recognise that
 * 402 and render a nudge instead of an error, plus remember the tier the
 * bootstrap route reported so surfaces can adapt before anyone hits a wall.
 *
 * Deliberately not a context/provider: the tier changes at most once per
 * session (on grant), and a module-level value read by a tiny hook is less
 * machinery than a provider for something that is almost always constant.
 */

export type AccessTier = "visitor" | "pilot";

export const TIER_VISITOR: AccessTier = "visitor";
export const TIER_PILOT: AccessTier = "pilot";

/** HTTP status the backend uses for "you may see this, you may not pay for it". */
export const SPEND_DENIED_STATUS = 402;

/** Where a visitor goes to ask for a live tutor. */
export const ACCESS_REQUEST_PATH = "/teacher-access";

let currentTier: AccessTier = TIER_VISITOR;
const listeners = new Set<(tier: AccessTier) => void>();

/** The last tier the backend reported. Defaults to visitor — the safe value. */
export function getAccessTier(): AccessTier {
  return currentTier;
}

export function isVisitor(): boolean {
  return currentTier !== TIER_PILOT;
}

/** Record the tier from `POST /api/teacher/bootstrap`. Ignores junk. */
export function setAccessTier(tier: string | null | undefined): void {
  const next: AccessTier = tier === TIER_PILOT ? TIER_PILOT : TIER_VISITOR;
  if (next === currentTier) return;
  currentTier = next;
  listeners.forEach((fn) => fn(next));
}

export function subscribeAccessTier(fn: (tier: AccessTier) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * True when a response is the spend gate rather than an ordinary failure.
 *
 * Checked by status, never by message text — that is the entire reason the
 * backend uses 402 rather than overloading 403.
 */
export function isSpendDenied(resp: { status: number }): boolean {
  return resp.status === SPEND_DENIED_STATUS;
}

/** Copy for the nudge. Danish first — this is a ku.dk domain. */
export const ACCESS_NUDGE = {
  title: "Du udforsker AIPLA / You're exploring AIPLA",
  body:
    "Denne konto bruger en optaget demonstration. Lærere i programmet får en " +
    "live tutor til deres klasser. / This account uses a recorded demonstration. " +
    "Teachers in the programme get a live tutor for their classes.",
  cta: "Bliv en del af programmet / Join the programme",
} as const;

/** Reset for tests. */
export function __resetAccessTierForTests(): void {
  currentTier = TIER_VISITOR;
  listeners.clear();
}
