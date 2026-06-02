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

import { fetchWithTeacherAuth as fetchWithAuth } from "@/lib/apiClient";

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

export interface WorkbenchEventPayload {
  timestamp: string;
  server: string;
  tool: string;
  field: string;
  value: string;
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
  workbenchEvents?: WorkbenchEventPayload[];
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

/** Fetch a session summary for an anonymous group code.
 *  Pass ``sessionId`` to fetch a specific past session; omit it to fetch
 *  the most-recent session for the group. */
export async function fetchGroupLatestReport(
  groupCode: string,
  sessionId?: string | null,
): Promise<SessionSummaryPayload> {
  const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
  const resp = await fetchWithAuth(
    `/api/proxy/api/reports/groups/${encodeURIComponent(groupCode)}${qs}`,
  );
  return readJson<SessionSummaryPayload>(resp, "load group report");
}

// ---------------------------------------------------------------------------
// /api/classes/* — 1.A teacher-permission-model
// ---------------------------------------------------------------------------

export interface ClassPayload {
  classId: string;
  ownerUid: string;
  name: string;
  description: string | null;
  tagNamespace: string;
  lessons: string[];
  groupCodes: string[];
  revoked: boolean;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface ClassListPayload {
  classes: ClassPayload[];
}

export interface CreateClassBody {
  name: string;
  description?: string | null;
}

export interface LessonsPatchBody {
  add?: string[];
  remove?: string[];
}

export interface MintGroupsResult {
  classId: string;
  codes: string[];
}

/** List classes owned by the current teacher. */
export async function listClasses(): Promise<ClassPayload[]> {
  const resp = await fetchWithAuth(`/api/proxy/api/classes`);
  const body = await readJson<ClassListPayload>(resp, "list classes");
  return body.classes;
}

/** Create a class owned by the current teacher. */
export async function createClass(body: CreateClassBody): Promise<ClassPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/classes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<ClassPayload>(resp, "create class");
}

/** Read one class (owner-only — 404 for other teachers' classes). */
export async function getClass(classId: string): Promise<ClassPayload> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/classes/${encodeURIComponent(classId)}`,
  );
  return readJson<ClassPayload>(resp, "get class");
}

/** Update name and/or description. */
export async function patchClass(
  classId: string,
  body: { name?: string; description?: string | null },
): Promise<ClassPayload> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/classes/${encodeURIComponent(classId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return readJson<ClassPayload>(resp, "update class");
}

/** Soft-delete (idempotent). */
export async function deleteClass(
  classId: string,
): Promise<{ revoked: boolean; classId: string }> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/classes/${encodeURIComponent(classId)}`,
    { method: "DELETE" },
  );
  return readJson(resp, "delete class");
}

/** Add and/or remove skills from a class's lessons. */
export async function patchLessons(
  classId: string,
  body: LessonsPatchBody,
): Promise<ClassPayload> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/classes/${encodeURIComponent(classId)}/lessons`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return readJson<ClassPayload>(resp, "update lessons");
}

/** Mint N group codes under a class. */
export async function mintGroupCodes(
  classId: string,
  count = 1,
): Promise<MintGroupsResult> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/classes/${encodeURIComponent(classId)}/groups`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count }),
    },
  );
  return readJson<MintGroupsResult>(resp, "mint group codes");
}

// ---------------------------------------------------------------------------
// /api/skills — lesson catalogue used by the lessons picker on the class
// detail page. Reuses the same auth + AccessControl evaluator as the
// student-side /lessons picker.
// ---------------------------------------------------------------------------

export interface SkillSummary {
  skillId: string;
  name: string;
  slug?: string | null;
  displayName: string;
  description: string;
  avatar: string;
  ownerId: string;
}

/** List skills the current teacher can access (their own + class-bound + public).
 *  Returns the same shape as the student-side picker. */
export async function listAccessibleSkills(): Promise<SkillSummary[]> {
  const resp = await fetchWithAuth(`/api/proxy/api/skills`);
  if (!resp.ok) {
    throw new Error(`list skills: ${resp.status}`);
  }
  // Backend returns the full SkillConfig shape; we project to the fields
  // the picker needs to keep the wire small in tests.
  const full = (await resp.json()) as Array<{
    skillId: string;
    name: string;
    slug?: string | null;
    displayName?: string;
    description?: string;
    avatar?: string;
    ownerId: string;
  }>;
  return full.map((s) => ({
    skillId: s.skillId,
    name: s.name,
    slug: s.slug ?? null,
    displayName: s.displayName || s.name,
    description: s.description || "",
    avatar: s.avatar || "",
    ownerId: s.ownerId,
  }));
}

/** Revoke a single group code. */
export async function revokeGroupCode(
  classId: string,
  code: string,
): Promise<{ revoked: boolean; code: string; classId: string }> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/classes/${encodeURIComponent(classId)}/groups/${encodeURIComponent(code)}`,
    { method: "DELETE" },
  );
  return readJson(resp, "revoke group code");
}

export interface SessionRow {
  sessionId: string;
  ownerUid: string;
  skillId: string;
  groupCode: string | null;
  lastMessageAt: string;
  turnCount: number;
  title: string | null;
}

/** List recent student sessions across all group codes in a class. */
export async function listClassRecentSessions(
  classId: string,
  pageSize = 20,
): Promise<SessionRow[]> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/classes/${encodeURIComponent(classId)}/recent-sessions?page_size=${pageSize}`,
  );
  if (!resp.ok) return [];
  const body = (await resp.json()) as {
    sessions: Array<{
      sessionId: string;
      ownerUid: string;
      skillId: string;
      groupCode: string | null;
      lastMessageAt: string;
      turnCount: number;
      title: string | null;
    }>;
  };
  return body.sessions.map((s) => ({
    sessionId: s.sessionId,
    ownerUid: s.ownerUid,
    skillId: s.skillId,
    groupCode: s.groupCode,
    lastMessageAt: s.lastMessageAt,
    turnCount: s.turnCount,
    title: s.title,
  }));
}

/** Archive the active session for a group code so the next student join starts fresh. */
export async function resetGroupSession(
  classId: string,
  code: string,
): Promise<void> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/classes/${encodeURIComponent(classId)}/groups/${encodeURIComponent(code)}/reset-session`,
    { method: "POST" },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`reset session failed (${resp.status}): ${text}`);
  }
}
