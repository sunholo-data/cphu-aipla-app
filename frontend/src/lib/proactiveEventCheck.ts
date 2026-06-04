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

/** Token keywords for each meaningful category. The mapper splits an
 *  artefact's kind suffix on `-` and `_` and checks if ANY token in the
 *  split matches one of these keywords. Token-based so multi-word
 *  artefact kinds (e.g. `kinebot.sim-run`, `led-planck.auto-run`,
 *  `led-planck.step-change`) light up without per-artefact entries.
 *
 *  Add new keywords here when a new sim introduces a vocabulary that
 *  matches a category but doesn't already match. Keep the lists tight
 *  to avoid over-matching — e.g. NOT including `change` here because
 *  `state-change` is exploration noise, not progress.
 *
 *  Mirrors the backend allowlist `MEANINGFUL_EVENT_KINDS` in
 *  `backend/protocols/proactive_routes.py` (sim_run / step_advance /
 *  measurement_commit). The backend doesn't tokenize because the FE
 *  already mapped to a generic kind by the time the gate-check fires
 *  — backend just validates membership.
 */
const SIM_RUN_TOKENS = ["play", "run", "simulate", "afspil"];
const STEP_ADVANCE_TOKENS = [
  "step",
  "next",
  "advance",
  "placed", // led-planck.component-placed → step progress
  "calibrated", // led-planck.calibrated → setup step
];
const MEASUREMENT_COMMIT_TOKENS = [
  "measure",
  "record",
  "commit",
  "show_value", // boldkast.show_value (no hyphen)
  "reading", // led-planck.reading
  "fit", // led-planck.fit (curve fit on measured data)
  "spectrum", // led-planck.spectrum (recorded spectrum)
];

function tokensFromSuffix(suffix: string): string[] {
  // Split on hyphen AND underscore so multi-word artefact kinds match
  // single-word category keywords. Lowercase already applied by caller.
  return suffix.split(/[-_]/).filter(Boolean);
}

function suffixMatchesAny(suffix: string, keywords: readonly string[]): boolean {
  // Whole-suffix match first (covers `show_value` style underscore
  // keywords). Then per-token match.
  if (keywords.includes(suffix)) return true;
  const tokens = tokensFromSuffix(suffix);
  return tokens.some((t) => keywords.includes(t));
}

/** Map an artefact-side `kind` (e.g. `"boldkast.play"` or
 *  `"kinebot.sim-run"`) onto a generic meaningful event kind, or null
 *  if the artefact event isn't a proactive-trigger candidate. The
 *  mapping tokenizes the suffix (split on `-` and `_`) and checks
 *  category-keyword membership so multi-word artefact kinds light up
 *  without per-artefact code. Artefacts can also emit the generic
 *  kind directly if they prefer.
 *
 *  **Known artefact kinds (2026-06-04):**
 *
 *  - Boldkast: `play` → sim_run; `show_value` → measurement_commit;
 *    `state-change` / `pause` / `reset` / `open` → null (noise /
 *    lifecycle / undo).
 *  - KineBot: `sim-run` → sim_run; `state-change` → null.
 *  - LED Planck: `auto-run` → sim_run; `step-change` → step_advance;
 *    `component-placed` → step_advance; `calibrated` → step_advance;
 *    `reading` / `fit` / `spectrum` → measurement_commit;
 *    `state-change` / `led-polarity-error` → null.
 *
 *  Adding a new sim: name your meaningful kinds following the
 *  convention vocabulary (`*.play`, `*.run`, `*.step`, `*.next`,
 *  `*.measure`, `*.reading`, `*.fit`, etc.) and the mapper picks
 *  them up automatically. If your sim introduces new vocabulary that
 *  fits a category but doesn't match any keyword yet, extend the
 *  appropriate `*_TOKENS` list above.
 */
export function mapArtefactKindToMeaningful(
  kind: string | null | undefined,
): MeaningfulEventKind | null {
  if (!kind) return null;
  if (isMeaningfulEventKind(kind)) return kind;
  const suffix = kind.split(".").slice(-1)[0]?.toLowerCase() ?? "";
  if (!suffix) return null;
  if (suffixMatchesAny(suffix, SIM_RUN_TOKENS)) return "sim_run";
  if (suffixMatchesAny(suffix, STEP_ADVANCE_TOKENS)) return "step_advance";
  if (suffixMatchesAny(suffix, MEASUREMENT_COMMIT_TOKENS)) return "measurement_commit";
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
