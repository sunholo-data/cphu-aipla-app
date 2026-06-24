/**
 * Teacher API client — wraps the /api/activity-configs and /api/reports
 * endpoints behind typed helpers.
 *
 * The teacher surfaces (dashboard, class detail, activity editor, group
 * report, analytics) all read live backend data through this client. There
 * is no fallback to fabricated fixtures: pages show real data, an honest
 * empty state, or a load error — never invented content. (The earlier
 * scaffold module was removed once these endpoints existed; a CI guard
 * `check:no-mock` keeps it from creeping back into shipped surfaces.)
 *
 * Every call goes through `/api/proxy/...` so the Next.js proxy can
 * attach the right host headers + forward Authorization to the FastAPI
 * sidecar on port 1956.
 */

import { fetchWithTeacherAuth as fetchWithAuth } from "@/lib/apiClient";

export type Language = "da" | "en";
export type Difficulty = "standard" | "guided";
/** Workbench type system (1.J). ``none`` = chat-only concept activity.
 *  ``document`` (1.1.45 M3b) = a document-feedback activity: the student uploads
 *  their own work into the workbench and the tutor critiques the active file. */
export type WorkbenchType =
  | "app"
  | "drawing"
  | "sensor"
  | "video"
  | "notebook"
  | "document"
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
  /** The vetted sim artefact this activity hosts (1.1.41). The GET serialises
   *  the full model, so the editor can hydrate + round-trip it. */
  artefactId?: string | null;
  checklist?: ChecklistItem[];
  table?: TableElement[];
  chart?: ChartElement[];
  calculator?: CalculatorElement[];
  note?: NoteElement[];
  solution?: SolutionElement[];
  materials?: MaterialRef[];
  updatedAt: string;
}

/** The voice an persona speaks with (1.1.11/1.1.12) — a Gemini-TTS voice
 *  (``ttsVoice``) directed by the persona's ``voicePrompt``. */
export interface PersonaVoice {
  ttsProvider?: string | null;
  ttsVoice?: string | null;
  language?: string | null;
  rate?: number | null;
}

/** A persona — a named character that ties configs together (1.1.12).
 *  A persona bundles four things, all surfaced in the picker so a teacher
 *  sees what it changes: identity (name + avatar), teaching style
 *  (``interactionStyle`` → an injected preamble), voice (``voice`` +
 *  ``voicePrompt`` spoken-tone direction), and a one-line ``bio``. */
export interface PersonaPayload {
  id: string;
  name: string;
  title: string | null;
  avatar: string;
  language: string;
  interactionStyle: InteractionStyle;
  bio: string | null;
  /** The persona's spoken voice (how it sounds). */
  voice?: PersonaVoice | null;
  /** Plain-language direction for the voice (what tone it's told to use). */
  voicePrompt?: string | null;
}

export interface ChecklistItem {
  id: string;
  label: string;
}

/** A column of a teacher-defined data table (1.1.38 M1). Mirrors the backend
 *  `TableColumn`. `kind` gates the student input control (numeric vs text). */
export interface TableColumn {
  id: string;
  label: string;
  unit?: string;
  kind?: "number" | "text";
}

/** A teacher-defined data table the student fills in (1.1.38 M1). Mirrors the
 *  backend `TableElement`; capped server-side (columns 1-8, rows 1-50). */
export interface TableElement {
  id: string;
  title?: string;
  columns: TableColumn[];
  rows: number;
}

/** A chart plotting the activity's data table (1.1.38 M2). Auto-binds to the
 *  first data table's first two numeric columns. */
export interface ChartElement {
  id: string;
  title?: string;
  chartKind: "scatter" | "line" | "bar";
}

/** A named variable a calculator formula references (1.1.38 M3). */
export interface CalcInput {
  id: string;
  label: string;
  unit?: string;
}

/** A teacher-authored formula calculator (1.1.38 M3). The formula is evaluated
 *  client-side by a safe whitelisted-grammar parser (no eval). */
export interface CalculatorElement {
  id: string;
  title?: string;
  formula: string;
  inputs: CalcInput[];
}

/** A teacher-authored instructions / reference note (1.1.38 M4). Markdown body,
 *  rendered read-only in the workspace. Distinct from uploaded `materials`. */
export interface NoteElement {
  id: string;
  title?: string;
  body: string;
}

/** A rich-text solution-editor element (1.1.45 M4, JB-2). The teacher authors the
 *  `prompt`; the student's writing is session state, not persisted on the config. */
export interface SolutionElement {
  id: string;
  prompt?: string;
}

/** A catalogued sim artefact a teacher can attach to an activity (1.1.41) — the
 *  public view from `GET /api/artefacts` (never the server-side `tutorBlock`). */
export interface ArtefactSummary {
  id: string;
  displayName: string;
  description: string;
  topics: string[];
  levels: StxLevel[];
  language: string;
  artefactPath: string;
  /** Optional preview image (path/URL). Unset → the UI draws an icon/monogram
   *  tile so the sim is still identifiable at a glance. */
  thumbnail?: string | null;
  status: string;
}

/** Danish stx physics level — the primary curriculum browse axis (1.1.25). */
export type StxLevel = "A" | "B" | "C";

/** A curriculum document cited for an activity (1.1.25 M3/M4).
 *  ``origin`` is cached from the library doc at citation time so the tutor
 *  grounding preamble can name the source without an extra read. */
export interface MaterialRef {
  /** 1.1.44 — "curriculum" (a RAG doc, the default/legacy) or "image" (a teacher
   *  image the tutor SEES multimodally). Absent ⇒ curriculum. */
  kind?: "curriculum" | "image";
  /** Curriculum doc id. Empty string for image materials. */
  docId: string;
  /** Source label (curriculum). Empty string for image materials. */
  origin: string;
  /** Image fields (1.1.44) — set when kind === "image". The bytes live in the
   *  activity artifact slot; materialId + mimeType identify them. */
  materialId?: string;
  mimeType?: string;
  alt?: string;
  /** 1.1.33 M2a — the teacher decides, per material, whether it's shown to
   *  students in the Documents workbench surface. Default false (opt-in).
   *  Governs only the student-facing surface; RAG grounding uses all materials. */
  studentVisible?: boolean;
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
  /** Dead knob (1.1.32) — stored on the model for back-compat but no longer
   *  set from the teacher UI and consumed nowhere. Omit and the backend keeps
   *  its `"standard"` default. Do not resurrect a control without a consumer. */
  difficulty?: Difficulty;
  interactionStyle?: InteractionStyle;
  persona?: string | null;
  /** Legacy decoupled-sim pointer (1.1.32) — a sim is the *skill* it runs
   *  (the chat workspace dispatches on the skill slug), so a concept
   *  activity can't host one. The teacher control was removed; the field
   *  stays on the model (legacy rows backfill `workbenchType="app"`) but is
   *  no longer set from the form. Activity↔sim 1:1 is the Phase-B template
   *  refactor. Omit it. */
  pairedWorkbench?: string | null;
  workbenchType?: WorkbenchType;
  /** The vetted sim artefact this activity hosts (1.1.41) — a catalogue id
   *  (`GET /api/artefacts`). Validated server-side; sets workbenchType=app. */
  artefactId?: string | null;
  checklist?: ChecklistItem[];
  /** Teacher-defined data tables the student fills in (1.1.38 M1). */
  table?: TableElement[];
  /** Charts plotting the activity's data table (1.1.38 M2). */
  chart?: ChartElement[];
  /** Formula calculators the student uses (1.1.38 M3). */
  calculator?: CalculatorElement[];
  /** Teacher-authored instructions / reference notes (1.1.38 M4). */
  note?: NoteElement[];
  solution?: SolutionElement[];
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
  /** Activity display name (resolved server-side), falls back to activityId. */
  activityName?: string | null;
  /** The class this group belongs to (for a back-link), null if unbound. */
  classId?: string | null;
  className?: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  messageCount: number;
  simRunCount: number;
  conversation: SessionTurnPayload[];
  workbenchEvents?: WorkbenchEventPayload[];
  /** 1.1.4 — AI narrative summary (structured markdown), or null when not
   *  yet generated / no conversation to summarise. */
  narrative?: string | null;
  /** 1.1.36 — the group's spoken-discussion transcript (joined), or null. */
  voiceTranscript?: string | null;
  /** 1.1.36 — total recorded audio minutes + segment count for the group. */
  voiceMinutes?: number;
  voiceSegments?: number;
  /** 1.1.36 — "what's included": the sources the narrative was built from + the
   *  model + generation state, for the report's transparency line. */
  inputs?: {
    chatTurns: number;
    audioMinutes: number;
    audioSegments: number;
    simEvents: number;
    model: string;
    generatedAt: string | null;
    state: "ready" | "none";
  };
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

/** List the sim-artefact catalogue (1.1.41) — the vetted, pilot-visible sims a
 *  teacher can attach to an activity. `tutorBlock` is never returned. */
export async function listArtefacts(): Promise<ArtefactSummary[]> {
  const resp = await fetchWithAuth(`/api/proxy/api/artefacts?status=live`);
  const data = await readJson<{ artefacts: ArtefactSummary[] }>(resp, "list artefacts");
  return data.artefacts;
}

/** List the available personas (the YAML catalogue, 1.1.12). */
export async function fetchPersonaList(): Promise<PersonaPayload[]> {
  const resp = await fetchWithAuth(`/api/proxy/api/personas`);
  const body = await readJson<{ personas: PersonaPayload[] }>(resp, "fetch personas");
  return body.personas;
}

/** What a teaching style actually enforces (1.1.32 transparency). ``prompt`` is
 *  the exact instruction the tutor is given; ``injected: false`` means it's the
 *  baked-in default (socratic) rather than an appended override. */
export interface InteractionStyleSpec {
  id: InteractionStyle;
  prompt: string;
  injected: boolean;
}

export interface PersonaCatalogue {
  personas: PersonaPayload[];
  /** The global default persona id (the one a class inherits when none is
   *  explicitly set). Used to badge it instead of a synthetic "Default" card. */
  defaultId: string | null;
  /** The instruction each teaching style enforces — so the picker can show a
   *  teacher exactly what a persona's style does to the tutor. */
  interactionStyles: InteractionStyleSpec[];
}

/** Fetch the persona catalogue + the global default id (1.1.12). */
export async function fetchPersonaCatalogue(): Promise<PersonaCatalogue> {
  const resp = await fetchWithAuth(`/api/proxy/api/personas`);
  const body = await readJson<{
    personas: PersonaPayload[];
    defaultId?: string | null;
    interactionStyles?: InteractionStyleSpec[];
  }>(resp, "fetch personas");
  return {
    personas: body.personas,
    defaultId: body.defaultId ?? null,
    interactionStyles: body.interactionStyles ?? [],
  };
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

/** List classes.
 *
 * - `scope="own"` (default): the caller's own classes.
 * - `scope="all"`: every class across all teachers — researcher-only
 *   (sprint 1.1.5). The backend returns 403 for non-researchers, so only
 *   call with `"all"` when {@link useIsResearcher} is true.
 */
export async function listClasses(scope: "own" | "all" = "own"): Promise<ClassPayload[]> {
  const query = scope === "all" ? "?scope=all" : "";
  const resp = await fetchWithAuth(`/api/proxy/api/classes${query}`);
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

/** A skill's access policy as the catalogue needs it (mirror of the backend
 *  `AccessControl`). Teacher-facing skills (manage-class, analytics-chat) are
 *  `{type: "tagged", tags: ["role:teacher"]}`; student-facing skills are
 *  `{type: "public"}` or null. */
export interface SkillAccessControl {
  type?: string | null;
  tags?: string[] | null;
}

export interface SkillSummary {
  skillId: string;
  name: string;
  slug?: string | null;
  displayName: string;
  description: string;
  avatar: string;
  ownerId: string;
  /** Access policy — lets the student-lesson picker exclude teacher-only
   *  skills (see `isTeacherOnlySkill`). */
  accessControl?: SkillAccessControl | null;
}

/** A skill gated to teachers (e.g. manage-class, analytics-chat) — it can never
 *  be a student lesson, so it must not appear in the "Add from catalogue"
 *  student-lesson picker (1.1.32). The gate is the synthetic `role:teacher`
 *  tag the backend AccessContext evaluator checks. */
export function isTeacherOnlySkill(s: SkillSummary): boolean {
  const ac = s.accessControl;
  return ac?.type === "tagged" && (ac.tags ?? []).includes("role:teacher");
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
    accessControl?: SkillAccessControl | null;
  }>;
  return full.map((s) => ({
    skillId: s.skillId,
    name: s.name,
    slug: s.slug ?? null,
    displayName: s.displayName || s.name,
    description: s.description || "",
    avatar: s.avatar || "",
    ownerId: s.ownerId,
    accessControl: s.accessControl ?? null,
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
