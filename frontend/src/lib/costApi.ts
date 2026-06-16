/**
 * Typed wrappers around the cost-dashboard REST surface (sprint 1.1.9):
 * - `GET /api/classes/{id}/spend`   — per-class spend (teacher or researcher)
 * - `GET /api/insights/cost`        — cross-class spend (researcher-only)
 *
 * Cost is computed server-side from BQ token sums priced via the code
 * rate card; the client just renders EUR figures.
 */

import { fetchWithTeacherAuth as fetchWithAuth } from "@/lib/apiClient";

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
}

async function readJson<T>(resp: Response, what: string): Promise<T> {
  if (!resp.ok) {
    throw new Error(`${what} failed (${resp.status})`);
  }
  return (await resp.json()) as T;
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
