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
