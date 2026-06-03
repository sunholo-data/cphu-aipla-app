/**
 * Proactive-tutor sentinels and detection helpers (sprint
 * PROACTIVE-SIM-REACTIVE M8).
 *
 * Both proactive turn kinds (Phase A auto-greet, Phase B sim-reactive)
 * are triggered by posting a synthetic user-role message whose content
 * is one of the bracketed sentinels below. The model is instructed to
 * treat these as system markers, NOT echo them as a literal response.
 *
 * Path B (this sprint) introduces a NEW frontend concern: when the FE
 * itself kicks off the AG-UI run via `agent.addMessage(...) +
 * runAgent()`, the sentinel message lands in the visible message list
 * and would render as a literal student chat bubble unless filtered.
 *
 * `isProactiveSentinel(content)` is the single point of truth used by
 * `useSkillAgent`'s `toSkillMessage` filter to drop sentinel-shaped
 * user messages from rendering. Keep these strings + pattern in sync
 * with:
 *   - backend/protocols/proactive_routes.py:PROACTIVE_GREET_TRIGGER
 *   - backend/protocols/proactive_routes.py minting in post_proactive_event_check
 *   - backend/adk/proactive_telemetry.py sentinel detection
 *
 * Drift between any two of these silently breaks proactive turns
 * (rendered sentinel, mis-tagged span, or unparseable backend marker).
 */

/** Phase A auto-greet sentinel — must match the backend's
 *  `PROACTIVE_GREET_TRIGGER` constant. */
export const PROACTIVE_GREET_SENTINEL = "[session_start]";

/** Phase B sim-reactive sentinel pattern — `[event_reactive:<kind>]`
 *  where `<kind>` is one of the allowlisted meaningful event kinds.
 *  Strict pattern (lowercase + underscores only) matches what the
 *  backend mints + what proactive_telemetry detects. */
const EVENT_REACTIVE_PATTERN = /^\[event_reactive:[a-z][a-z0-9_]*\]$/;

/** Returns true if `content` is one of the proactive sentinels.
 *  Trimming-tolerant: extra whitespace (e.g. a stray newline added by
 *  React's normalization) still matches. */
export function isProactiveSentinel(content: string | null | undefined): boolean {
  if (!content) return false;
  const stripped = content.trim();
  if (stripped === PROACTIVE_GREET_SENTINEL) return true;
  if (EVENT_REACTIVE_PATTERN.test(stripped)) return true;
  return false;
}

/** Build the sim-reactive sentinel string from a meaningful event kind.
 *  Caller (typically `useProactiveEventCheck`) hands this to
 *  `useSkillAgent.sendMessage` to kick off the AG-UI run. */
export function eventReactiveSentinel(eventKind: string): string {
  return `[event_reactive:${eventKind}]`;
}
