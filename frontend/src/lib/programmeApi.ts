/**
 * Typed wrappers around the delegated-administration surface
 * (PROGADMIN-1 — 1.1.76):
 *
 * - `GET /api/programme/access/list`     — the access register
 * - `GET /api/programme/access/requests` — the queue from /teacher-access
 *
 * Both are researcher-OR-programme-admin; the backend answers 404 (not 403)
 * for anyone else, so a plain teacher cannot learn the surface exists.
 *
 * Teacher auth, always: every caller here is a Firebase teacher identity.
 * An anonymous-group student has no business on this surface — see the
 * dual-auth footgun in CLAUDE.md.
 */

import { fetchWithTeacherAuth } from "@/lib/apiClient";
import { readJson } from "@/lib/apiResponse";

/** Which door a grant came through. Empty on rows written before 1.1.76 —
 *  treat empty as `service-account`, since that was the only door then. */
export type GrantedVia = "service-account" | "programme-admin" | "";

export interface RegisterRow {
  email: string;
  tier: string;
  monthlyCapUsd: number;
  grantedBy: string;
  grantedVia: GrantedVia;
  grantedAt: string;
  expiresAt: string | null;
  active: boolean;
  revoked: boolean;
  uid: string | null;
  note: string;
  /** Spend so far this period, USD. `null` means the total could NOT be read —
   *  which is a different fact from zero, and must not render as "$0.00". */
  spentThisPeriodUsd: number | null;
}

export interface RegisterPayload {
  count: number;
  /** Whether THIS caller may write. A researcher gets `false` and sees the
   *  same tables with no buttons — one surface, two privilege levels. */
  canWrite: boolean;
  grants: RegisterRow[];
}

export interface AccessRequestRow {
  uid: string;
  email: string;
  name: string;
  institution: string;
  message: string;
  status: string;
  requestedAt: string;
}

export interface RequestsPayload {
  count: number;
  canWrite: boolean;
  requests: AccessRequestRow[];
}

export async function fetchRegister(includeRevoked = false): Promise<RegisterPayload> {
  const res = await fetchWithTeacherAuth(
    `/api/proxy/api/programme/access/list?include_revoked=${includeRevoked ? "true" : "false"}`,
  );
  return readJson<RegisterPayload>(res, "Could not load the access register");
}

export async function fetchAccessRequests(status = "pending"): Promise<RequestsPayload> {
  const res = await fetchWithTeacherAuth(
    `/api/proxy/api/programme/access/requests?status=${encodeURIComponent(status)}`,
  );
  return readJson<RequestsPayload>(res, "Could not load the access-request queue");
}

export interface GrantInput {
  email: string;
  tier?: string;
  monthlyCapUsd?: number;
  expiresAt?: string;
  note?: string;
}

/** Admit a teacher, or re-set their cap — the same call, because
 *  `grant_access` is idempotent and preserves the audit trail.
 *
 *  Every bound is re-checked server-side; a 403 here carries the bound in its
 *  message, so surface the message rather than a generic failure. */
export async function grantAccess(input: GrantInput): Promise<RegisterRow> {
  const res = await fetchWithTeacherAuth("/api/proxy/api/programme/access/grant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<RegisterRow>(res, "Could not grant access");
}

export async function revokeAccess(email: string): Promise<{ email: string; revoked: boolean }> {
  const res = await fetchWithTeacherAuth("/api/proxy/api/programme/access/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return readJson<{ email: string; revoked: boolean }>(res, "Could not revoke access");
}

export interface ProgrammeBudgetPayload {
  /** `null` = unset, which is the honest default while there is no pilot data
   *  to pick a number from. The per-teacher caps and the GCP quota already
   *  bound things without it. */
  dailyBudgetUsd: number | null;
  action: "warn" | "block";
  updatedBy: string;
  updatedAt: string;
  /** `null` when the total could not be read — never dressed as zero. */
  spentTodayUsd: number | null;
  /** The ceiling this budget sits under. A value above it would read as
   *  raising that ceiling while doing nothing. */
  ceilingUsd: number;
  canWrite: boolean;
}

export async function fetchProgrammeBudget(): Promise<ProgrammeBudgetPayload> {
  const res = await fetchWithTeacherAuth("/api/proxy/api/programme/budget");
  return readJson<ProgrammeBudgetPayload>(res, "Could not load the programme budget");
}

export async function setProgrammeBudget(
  dailyBudgetUsd: number | null,
  action: "warn" | "block" = "warn",
): Promise<ProgrammeBudgetPayload> {
  const res = await fetchWithTeacherAuth("/api/proxy/api/programme/budget", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dailyBudgetUsd, action }),
  });
  return readJson<ProgrammeBudgetPayload>(res, "Could not set the programme budget");
}

/** How a row's spend reads against its cap. `unknown` is its own state: a
 *  failed read must never render as the reassuring answer. */
export type SpendState = "unknown" | "ok" | "warn" | "over";

export function spendState(row: RegisterRow): SpendState {
  if (row.spentThisPeriodUsd === null || row.spentThisPeriodUsd === undefined) return "unknown";
  if (isUncapped(row) || row.monthlyCapUsd <= 0) return "ok";
  const ratio = row.spentThisPeriodUsd / row.monthlyCapUsd;
  if (ratio >= 1) return "over";
  if (ratio >= 0.8) return "warn";
  return "ok";
}

export function formatSpend(row: RegisterRow): string {
  if (row.spentThisPeriodUsd === null || row.spentThisPeriodUsd === undefined) return "unreadable";
  return `$${row.spentThisPeriodUsd.toFixed(2)}`;
}

/** `—` for an uncapped row must read as an ALARM, not a blank.
 *
 *  A cap of 0 disables the per-teacher gate outright (verified 2026-08-12: a
 *  turn projected at $999,999 returns `allow`), so an uncapped row is not
 *  "no limit configured yet" — it is "bounded only by the shared project
 *  ceiling, and able to starve every other teacher on it". An empty cell
 *  would be the interface lying by omission. */
export function isUncapped(row: RegisterRow): boolean {
  return row.monthlyCapUsd < 0;
}

export function formatCap(row: RegisterRow): string {
  return isUncapped(row) ? "UNCAPPED" : `$${row.monthlyCapUsd.toFixed(2)}`;
}
