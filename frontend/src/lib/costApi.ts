/**
 * Typed wrappers around the cost-dashboard REST surface (sprint 1.1.9):
 * - `GET /api/classes/{id}/spend`   — per-class spend (teacher or researcher)
 * - `GET /api/insights/cost`        — cross-class spend (researcher-only)
 *
 * Cost is computed server-side from BQ token sums priced via the code
 * rate card; the client just renders EUR figures.
 */

import { fetchWithTeacherAuth as fetchWithAuth } from "@/lib/apiClient";
import { readJson as sharedReadJson } from "@/lib/apiResponse";

export type SpendPeriod = "this_month" | "last_month" | "all_time";

export interface SpendBucket {
  eur: number;
}
export interface ActivitySpend extends SpendBucket {
  skill_id: string;
}
export interface GroupSpend extends SpendBucket {
  group_id: string;
}
export interface ModelSpend extends SpendBucket {
  model: string;
}
/** Voice (STT/TTS) spend by kind — 1.1.9 voice-cost integration. */
export interface VoiceKindSpend extends SpendBucket {
  kind: string;
  /** Provenance volume: characters synthesized (TTS) or milliseconds
   *  transcribed (STT). Present so the UI can show that voice was USED even
   *  when it priced to zero — a free tier and a mispriced one are both
   *  "someone pressed play", and both used to be indistinguishable from
   *  "nobody did". Older payloads omit it. */
  units?: number;
}

export interface ClassSpendPayload {
  currency: string;
  class_id: string;
  period: SpendPeriod;
  total_eur: number;
  token_in: number;
  token_out: number;
  projected_eur: number | null;
  by_activity: ActivitySpend[];
  by_group: GroupSpend[];
  by_model: ModelSpend[];
  /** Voice (STT/TTS) cost, EUR — included in total_eur. */
  voice_eur: number;
  /** Total voice volume (TTS characters + STT milliseconds). Non-zero whenever
   *  voice was used at all, regardless of what it cost. */
  voice_units?: number;
  by_voice_kind: VoiceKindSpend[];
}

export interface CohortSpend extends SpendBucket {
  cohort: string;
}
export interface PerClassSpend extends SpendBucket {
  class_id: string;
  name: string;
  cohort: string;
}

export interface CostInsightsPayload {
  currency: string;
  period: SpendPeriod;
  total_eur: number;
  by_cohort: CohortSpend[];
  by_model: ModelSpend[];
  per_class: PerClassSpend[];
  /** Voice (STT/TTS) cost, EUR — included in total_eur. */
  voice_eur: number;
  /** Total voice volume (TTS characters + STT milliseconds). Non-zero whenever
   *  voice was used at all, regardless of what it cost. */
  voice_units?: number;
  by_voice_kind: VoiceKindSpend[];
}

/** Was voice used at all this period, regardless of what it cost?
 *
 *  Gating the voice line on `voice_eur > 0` hid a real bug for weeks: the
 *  Gemini tier that carries ~100% of read-aloud traffic had no rate, so it
 *  priced to zero, so the line never rendered — and a missing row reads as
 *  "no voice used", not as "voice we failed to price". Keying on usage makes
 *  the zero visible and therefore fixable. Falls back to cost for payloads
 *  from a backend that predates `voice_units`. */
export function usedVoice(payload: {
  voice_eur: number;
  voice_units?: number;
  by_voice_kind: VoiceKindSpend[];
}): boolean {
  if ((payload.voice_units ?? 0) > 0) return true;
  if (payload.by_voice_kind.some((v) => (v.units ?? 0) > 0)) return true;
  return payload.voice_eur > 0;
}

async function readJson<T>(resp: Response, what: string): Promise<T> {
  return sharedReadJson<T>(resp, what, {
    toError: ({ status, message }) => new Error(`${message} failed (${status})`),
  });
}

/** Per-class spend breakdown. */
export async function fetchClassSpend(
  classId: string,
  period: SpendPeriod = "this_month",
): Promise<ClassSpendPayload> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/classes/${encodeURIComponent(classId)}/spend?period=${period}`,
  );
  return readJson<ClassSpendPayload>(resp, "fetch class spend");
}

/** Cross-class cost overview (researcher-only; backend 403s otherwise). */
export async function fetchCostInsights(
  period: SpendPeriod = "this_month",
): Promise<CostInsightsPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/insights/cost?period=${period}`);
  return readJson<CostInsightsPayload>(resp, "fetch cost insights");
}

/** Teacher-scoped spend: EUR total + per-class across the CALLER's own classes
 *  (any teacher; no researcher claim). Powers the class-list spend summary. */
export interface TeacherSpendPayload {
  currency: string;
  period: SpendPeriod;
  total_eur: number;
  per_class: { class_id: string; eur: number }[];
}

export async function fetchTeacherSpend(
  period: SpendPeriod = "this_month",
): Promise<TeacherSpendPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/insights/cost/mine?period=${period}`);
  return readJson<TeacherSpendPayload>(resp, "fetch teacher spend");
}

/** Format an EUR amount for display (2 dp, € prefix). */
export function formatEur(eur: number): string {
  return `€${eur.toFixed(2)}`;
}
