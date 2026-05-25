/**
 * Teacher API client — wraps the /api/activity-configs and /api/reports
 * endpoints behind typed helpers.
 *
 * Phase 2 (1.G-Ph2) scope: only the two screens that wire to real
 * backend data go through this client (activity config + per-group
 * report). Dashboard, class detail, and analytics still consume
 * `_mock-data.ts` directly until Phase 3.
 *
 * Every call goes through `/api/proxy/...` so the Next.js proxy can
 * attach the right host headers + forward Authorization to the FastAPI
 * sidecar on port 1956.
 */

import { fetchWithAuth } from "@/lib/apiClient";

export type Language = "da" | "en";
export type Difficulty = "standard" | "guided";

export interface ActivityConfigPayload {
  activityId: string;
  classId: string;
  teacherUid: string;
  teachingGoal: string;
  language: Language;
  difficulty: Difficulty;
  pairedWorkbench: string | null;
  updatedAt: string;
}

export interface ActivityConfigUpsert {
  activityId: string;
  classId: string;
  teachingGoal: string;
  language: Language;
  difficulty: Difficulty;
  pairedWorkbench: string | null;
}

export interface SessionTurnPayload {
  timestamp: string;
  role: "student" | "tutor";
  content: string;
}

export interface SessionSummaryPayload {
  sessionId: string;
  groupCode: string | null;
  activityId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  messageCount: number;
  simRunCount: number;
  conversation: SessionTurnPayload[];
}

export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

async function readJson<T>(resp: Response, errMsg: string): Promise<T> {
  if (resp.status === 404) {
    throw new NotFoundError(errMsg);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`${errMsg}: ${resp.status} ${body.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

/** Read the current teacher's saved config for an activity in a class. */
export async function fetchMyActivityConfig(
  classId: string,
  activityId: string,
): Promise<ActivityConfigPayload> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/activity-configs/mine/${encodeURIComponent(
      classId,
    )}/${encodeURIComponent(activityId)}`,
  );
  return readJson<ActivityConfigPayload>(resp, "load activity config");
}

/** Create or overwrite the current teacher's activity config. */
export async function saveActivityConfig(
  body: ActivityConfigUpsert,
): Promise<ActivityConfigPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/activity-configs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<ActivityConfigPayload>(resp, "save activity config");
}

/** Fetch the latest session summary for an anonymous group code. */
export async function fetchGroupLatestReport(
  groupCode: string,
): Promise<SessionSummaryPayload> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/reports/groups/${encodeURIComponent(groupCode)}`,
  );
  return readJson<SessionSummaryPayload>(resp, "load group report");
}
