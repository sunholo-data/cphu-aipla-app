/**
 * Proactive sim-reactive event-check client — Phase B (Path B).
 *
 * Wraps the gate-decision endpoint `POST /api/sessions/{id}/proactive-event-check`.
 * When a meaningful workbench event commits, the FE calls this to ask
 * the backend whether to fire a proactive tutor turn. On `shouldFire`,
 * the caller (typically `useProactiveEventCheck`) takes the returned
 * trigger sentinel and posts it to the existing AG-UI chat endpoint
 * via `useSkillAgent.sendMessage` so the proactive turn rides the
 * established protocol stack.
 *
 * Architecture: Path B per sprint PROACTIVE-SIM-REACTIVE. Backend owns
 * the gate decision (auth, cooldown, cap, idle threshold, allowlist);
 * frontend owns the trigger handoff to AG-UI. See
 * docs/design/aipla/v1.1.0-feedback/proactive-sim-reactive-tutor.md.
 *
 * The set of `eventKind` values accepted by the backend allowlist is
 * exported as `MEANINGFUL_EVENT_KINDS` so callers can pre-filter
 * client-side before paying for a network round-trip. Keep in sync
 * with backend/protocols/proactive_routes.py:MEANINGFUL_EVENT_KINDS.
 */

import { fetchWithAuth } from "@/lib/apiClient";

/** Generic event kinds the backend accepts. Mirror of
 *  backend/protocols/proactive_routes.py:MEANINGFUL_EVENT_KINDS.
 *  Drift between these two sets silently hides proactive turns. */
export const MEANINGFUL_EVENT_KINDS = [
  "sim_run",
  "step_advance",
  "measurement_commit",
] as const;
export type MeaningfulEventKind = (typeof MEANINGFUL_EVENT_KINDS)[number];

export function isMeaningfulEventKind(value: string): value is MeaningfulEventKind {
  return (MEANINGFUL_EVENT_KINDS as readonly string[]).includes(value);
}

/** Map an artefact-side `kind` (e.g. `"boldkast.play"`) onto a generic
 *  meaningful event kind, or null if the artefact event isn't a
 *  proactive-trigger candidate. The mapping is intentionally permissive
 *  (suffix-based) so new artefacts following the same naming
 *  conventions (`*.play`, `*.step`, `*.measure`) light up automatically.
 *  Artefacts can also emit the generic kind directly if they prefer.
 *
 *  Boldkast 2026-06-03: emits `boldkast.play`, `boldkast.show_value`,
 *  `boldkast.state-change`, `boldkast.pause`, `boldkast.reset`,
 *  `boldkast.open`. Only `boldkast.play` and `boldkast.show_value`
 *  map to meaningful kinds; the rest correctly return null (state
 *  noise, pause/reset, artefact-lifecycle).
 *
 *  LED Planck / KineBot do not currently emit kinds; this mapper is
 *  ready when their artefacts add `emit()` calls.
 */
export function mapArtefactKindToMeaningful(
  kind: string | null | undefined,
): MeaningfulEventKind | null {
  if (!kind) return null;
  if (isMeaningfulEventKind(kind)) return kind;
  const suffix = kind.split(".").slice(-1)[0]?.toLowerCase() ?? "";
  if (suffix === "play" || suffix === "run" || suffix === "simulate") return "sim_run";
  if (suffix === "step" || suffix === "next" || suffix === "advance") return "step_advance";
  if (
    suffix === "measure" ||
    suffix === "record" ||
    suffix === "commit" ||
    suffix === "show_value"
  )
    return "measurement_commit";
  return null;
}

export interface ProactiveEventCheckResponse {
  shouldFire: boolean;
  reason?: string;
  trigger?: string;
  sessionId?: string;
}

/** POST the gate-check request. Throws on network / non-OK response so
 *  callers can decide whether to log-and-swallow or surface. */
export async function fetchProactiveEventCheck(args: {
  sessionId: string;
  skillId: string;
  eventKind: MeaningfulEventKind;
  eventPayload?: Record<string, unknown>;
}): Promise<ProactiveEventCheckResponse> {
  const { sessionId, skillId, eventKind, eventPayload } = args;
  const resp = await fetchWithAuth(
    `/api/proxy/api/sessions/${encodeURIComponent(sessionId)}/proactive-event-check`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillId,
        eventKind,
        eventPayload: eventPayload ?? null,
      }),
    },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `proactive-event-check failed: ${resp.status} ${body.slice(0, 200)}`,
    );
  }
  return (await resp.json()) as ProactiveEventCheckResponse;
}
