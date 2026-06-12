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
/** Workbench type system (1.J). ``none`` = chat-only concept activity. */
export type WorkbenchType =
  | "app"
  | "drawing"
  | "sensor"
  | "video"
  | "notebook"
  | "none";

/** Tutor interaction style (1.1.20). ``socratic`` is the untouched default. */
export type InteractionStyle = "socratic" | "concise" | "rigorous" | "warm";

export interface ActivityConfigPayload {
  activityId: string;
  classId: string;
  teacherUid: string;
  title?: string;
  teachingGoal: string;
  language: Language;
  difficulty: Difficulty;
  interactionStyle?: InteractionStyle;
  persona?: string | null;
  pairedWorkbench: string | null;
  workbenchType?: WorkbenchType;
  materials?: MaterialRef[];
  updatedAt: string;
}

/** A persona — a named character that ties configs together (1.1.12). */
export interface PersonaPayload {
  id: string;
  name: string;
  title: string | null;
  avatar: string;
  language: string;
  interactionStyle: InteractionStyle;
  bio: string | null;
}

export interface ChecklistItem {
  id: string;
  label: string;
}

/** Danish stx physics level — the primary curriculum browse axis (1.1.25). */
export type StxLevel = "A" | "B" | "C";

/** A curriculum document cited for an activity (1.1.25 M3/M4).
 *  ``origin`` is cached from the library doc at citation time so the tutor
 *  grounding preamble can name the source without an extra read. */
export interface MaterialRef {
  docId: string;
  origin: string;
}

export interface ActivityConfigUpsert {
  /** Omit to let the backend mint a teacher-namespaced id (CLI/branching).
   *  The teacher builder passes a fixed base-skill id so the activity is
   *  immediately student-runnable (TAA-1 M0). */
  activityId: string;
  classId: string;
  title?: string;
  teachingGoal: string;
  language: Language;
  difficulty: Difficulty;
  interactionStyle?: InteractionStyle;
  persona?: string | null;
  pairedWorkbench: string | null;
  workbenchType?: WorkbenchType;
  checklist?: ChecklistItem[];
  materials?: MaterialRef[];
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

/** List the current teacher's activities (optionally scoped to one class).
 *  Backs the Activities library index — teacher-scoped by construction. */
export async function listMyActivities(
  classId?: string,
): Promise<ActivityConfigPayload[]> {
  const qs = classId ? `?classId=${encodeURIComponent(classId)}` : "";
  const resp = await fetchWithAuth(`/api/proxy/api/activity-configs${qs}`);
  return readJson<ActivityConfigPayload[]>(resp, "list activities");
}

/** List the available personas (the YAML catalogue, 1.1.12). */
export async function fetchPersonaList(): Promise<PersonaPayload[]> {
  const resp = await fetchWithAuth(`/api/proxy/api/personas`);
  const body = await readJson<{ personas: PersonaPayload[] }>(resp, "fetch personas");
  return body.personas;
}

export interface PersonaCatalogue {
  personas: PersonaPayload[];
  /** The global default persona id (the one a class inherits when none is
   *  explicitly set). Used to badge it instead of a synthetic "Default" card. */
  defaultId: string | null;
}

/** Fetch the persona catalogue + the global default id (1.1.12). */
export async function fetchPersonaCatalogue(): Promise<PersonaCatalogue> {
  const resp = await fetchWithAuth(`/api/proxy/api/personas`);
  const body = await readJson<{ personas: PersonaPayload[]; defaultId?: string | null }>(
    resp,
    "fetch personas",
  );
  return { personas: body.personas, defaultId: body.defaultId ?? null };
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

export interface ClassVoiceSettingsPayload {
  language: string | null;
  voice: string | null;
  provider: string | null;
}

export interface ClassPayload {
  classId: string;
  ownerUid: string;
  name: string;
  description: string | null;
  tagNamespace: string;
  lessons: string[];
  groupCodes: string[];
  voice?: ClassVoiceSettingsPayload | null;
  persona?: string | null;
  voiceInputEnabled?: boolean;
  recordingEnabled?: boolean;
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

/** 1.1.11 — write the per-class voice override. Pass all three null
 * to clear and fall back to skill defaults. */
export async function setClassVoiceSettings(
  classId: string,
  body: ClassVoiceSettingsPayload,
): Promise<{ ok: boolean }> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/voice/class/${encodeURIComponent(classId)}/settings`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return readJson(resp, "update class voice settings");
}

/** VOICE-IN-REC M4 — toggle the per-class voice-in / lesson-recording
 * capabilities. Only the passed flags are written. */
export async function setClassCapabilities(
  classId: string,
  body: { voiceInputEnabled?: boolean; recordingEnabled?: boolean },
): Promise<{ ok: boolean }> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/voice/class/${encodeURIComponent(classId)}/capabilities`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return readJson(resp, "update class capabilities");
}

/** Set (or clear with null) the per-class default persona — the one identity
 * choice that sets avatar + name + voice + teaching style for the class. */
export async function setClassPersona(
  classId: string,
  personaId: string | null,
): Promise<{ ok: boolean }> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/voice/class/${encodeURIComponent(classId)}/persona`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId }),
    },
  );
  return readJson(resp, "update class persona");
}

export interface VoiceListEntry {
  name: string;
  provider: string;
  tier: string;
  gender: string;
  label: string;
}

export interface VoiceListResponse {
  languages: string[];
  voices: Record<string, VoiceListEntry[]>;
}

/** 1.1.11 — curated voice catalogue for the teacher dropdown. */
export async function fetchVoiceList(
  lang?: string,
): Promise<VoiceListResponse> {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  const resp = await fetchWithAuth(`/api/proxy/api/voice/voices${q}`);
  return readJson<VoiceListResponse>(resp, "fetch voices");
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
  return readJson<ClassPayload>(resp, "update activities");
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
