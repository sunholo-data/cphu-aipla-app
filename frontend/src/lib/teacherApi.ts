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
import { readJson as sharedReadJson } from "@/lib/apiResponse";
// TYPE-ONLY, and it must stay that way: curriculumApi imports StxLevel from
// here, so a value import would close a runtime cycle. Types are erased.
// The activity library reuses the curriculum facet shapes verbatim rather than
// declaring twins — one vocabulary, one wire format (1.1.61).
import type { CurriculumFacets, LevelFilter } from "@/lib/curriculumApi";

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
  document?: DocumentElement[];
  conceptMap?: ConceptMapElement[];
  materials?: MaterialRef[];
  /** 1.1.61 — the activity's OWN organising facets, sharing the curriculum
   *  vocabulary. Set from the library row, never in the builder; the builder
   *  round-trips them so a full-overwrite save cannot wipe them. */
  tags?: string[];
  subject?: string | null;
  level?: StxLevel | null;
  /** 1.1.61 — DERIVED, read-only: the facets this activity gets from the
   *  documents it cites, resolved per-request against the CALLER's visible
   *  corpus. Present on list responses. Never send these back — they belong to
   *  the documents, and writing them would freeze a derived value. */
  inheritedTags?: string[];
  inheritedSubjects?: string[];
  inheritedLevels?: string[];
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

// Workbench element types are defined once in lib/elementTypes.ts (the single
// TS mirror of the backend Pydantic models). Imported here for the wire/save
// payloads below and re-exported so existing `from "@/lib/teacherApi"` imports
// keep working.
import type {
  CalcInput,
  CalculatorElement,
  ChartElement,
  ChecklistItem,
  ConceptMapElement,
  DocumentElement,
  NoteElement,
  SolutionElement,
  TableColumn,
  TableElement,
} from "./elementTypes";

export type {
  CalcInput,
  CalculatorElement,
  ChartElement,
  ChecklistItem,
  ConceptMapElement,
  DocumentElement,
  NoteElement,
  SolutionElement,
  TableColumn,
  TableElement,
};

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
  /** Provenance (curriculum): "uvm.dk", "Haka Fysik", a teacher name. Empty
   *  string for image materials. NOT a title — see `title` below. */
  origin: string;
  /** 1.1.63 M1 — the doc's human title, cached at citation time alongside
   *  `origin`. The tutor cites BY TITLE; `origin` trails as provenance.
   *  Optional: materials cited before 1.1.63 have none and fall back to
   *  `origin`, which is exactly the old behaviour. Every attach site must set
   *  it, or it silently stays empty forever. */
  title?: string;
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
  document?: DocumentElement[];
  conceptMap?: ConceptMapElement[];
  materials?: MaterialRef[];
  /** Day-0 overwrite guard (ALS-1 M0.5-guard). The create page sets this so a
   *  SECOND create of the same (teacher, class, activity) is refused (409)
   *  instead of silently overwriting the first. The edit page omits it (the
   *  idempotent upsert stands). Retired once M0 mints distinct ids. */
  createOnly?: boolean;
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

/** Thrown on a 409 — carries the backend's `detail` so the caller can show the
 *  honest message (e.g. the ALS-1 day-0 overwrite guard). */
export class ConflictError extends Error {
  constructor(message = "conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

async function readJson<T>(resp: Response, errMsg: string): Promise<T> {
  return sharedReadJson<T>(resp, errMsg, {
    toError: ({ status, body, message }) => {
      if (status === 404) return new NotFoundError(message);
      if (status === 409) {
        let detail = "";
        try {
          const parsed = JSON.parse(body) as { detail?: unknown };
          if (typeof parsed.detail === "string") detail = parsed.detail;
        } catch {
          /* non-JSON body → fall back to the per-call label */
        }
        return new ConflictError(detail || message);
      }
      return new Error(`${message}: ${status} ${body.slice(0, 200)}`);
    },
  });
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

// ── ALS-1 M0/M1: the class-independent Activity store ─────────────────────────
// An Activity is owned by a teacher and minted `act-…` (distinct from any skill
// id — which is what removed the overwrite collision). The builder create/edit
// pages write here; the student lesson list resolves from Class.activity_ids.

/** Wire shape for the Activity content the builder assembles (create + edit). */
export interface ActivityUpsertBody {
  /** The skill this activity runs (concept-dialogue id for a concept activity). */
  skillId: string;
  /** On create only: also assign the new activity to this class. */
  classId?: string;
  title?: string;
  teachingGoal: string;
  language: Language;
  workbenchType?: WorkbenchType;
  artefactId?: string | null;
  checklist?: ChecklistItem[];
  table?: TableElement[];
  chart?: ChartElement[];
  calculator?: CalculatorElement[];
  note?: NoteElement[];
  solution?: SolutionElement[];
  document?: DocumentElement[];
  conceptMap?: ConceptMapElement[];
  materials?: MaterialRef[];
  /** 1.1.61 — carried so a full-overwrite save cannot wipe facets set from the
   *  library row. `useActivityBuilder.toSavePayload()` always supplies them. */
  tags?: string[];
  subject?: string | null;
  level?: StxLevel | null;
}

/** The persisted Activity (create/edit responses). Structurally a superset of
 *  ActivityConfigPayload for the fields `useActivityBuilder.hydrate` reads. */
export interface ActivityPayload extends ActivityConfigPayload {
  ownerUid: string;
  /** Friendly owner label (display name / email), present only in the
   *  researcher `scope=all` view and only when resolvable; clients fall back
   *  to `ownerUid`. */
  ownerLabel?: string;
  skillId: string;
  visibility: "draft" | "private" | "published";
  /** Provenance (set when this activity was duplicated or adopted from another).
   *  `sourceOwnerLabel` is the friendly name of the source owner — present only
   *  on the single-activity GET and only when resolvable (M-HIST); clients fall
   *  back to `sourceOwnerUid`. */
  sourceActivityId?: string | null;
  sourceOwnerUid?: string | null;
  sourceOwnerLabel?: string;
  /** ISO lifecycle timestamps (the create stamp; `updatedAt` is inherited). */
  createdAt?: string | null;
}

/** Create a new activity (mints a distinct `act-…` id — never collides). When
 *  `classId` is set it is also assigned to that class in one call. */
export async function createActivity(body: ActivityUpsertBody): Promise<ActivityPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<ActivityPayload>(resp, "create activity");
}

/** Load one activity for editing (owner-only). */
export async function fetchActivity(activityId: string): Promise<ActivityPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/activities/${encodeURIComponent(activityId)}`);
  return readJson<ActivityPayload>(resp, "load activity");
}

/** Edit an activity (owner-only, full payload). */
export async function updateActivity(activityId: string, body: ActivityUpsertBody): Promise<ActivityPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/activities/${encodeURIComponent(activityId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<ActivityPayload>(resp, "update activity");
}

/** 1.1.61 — the facet filters the activity library and catalogue share with the
 *  curriculum browse. `level` accepts the `__unlevelled__` sentinel; `tags` is an
 *  AND facet; `q` is free text over title + goal + own AND inherited tags. */
export interface ActivityFilterParams {
  level?: LevelFilter;
  subject?: string;
  tags?: string[];
  q?: string;
  limit?: number;
  offset?: number;
}

/** 1.1.61 — paginated envelope. `total` is the FULL match count (not the page
 *  length), so the UI can say "X of Y" and know when to stop scrolling. */
export interface ActivityListPage {
  activities: ActivityPayload[];
  total: number;
  limit: number;
  offset: number;
}

function activityFilterQuery(params: ActivityFilterParams = {}): string {
  const qs = new URLSearchParams();
  if (params.level) qs.set("level", params.level);
  if (params.subject) qs.set("subject", params.subject);
  // Repeatable ?tags=a&tags=b — an AND facet server-side.
  (params.tags ?? []).forEach((t) => qs.append("tags", t));
  if (params.q?.trim()) qs.set("q", params.q.trim());
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  return qs.toString();
}

/** List activities (ALS-1 M1.2). `scope="own"` (default) → the caller's own
 *  library. `scope="all"` → every activity across all teachers, researcher-only
 *  (the backend 403s non-researchers; never a silent fallback). Read-only
 *  observation, mirroring the classes Research view. */
export async function listActivities(
  scope: "own" | "all" = "own",
  params: ActivityFilterParams = {},
): Promise<ActivityListPage> {
  const base = scope === "all" ? "scope=all" : "owner=me";
  const filters = activityFilterQuery(params);
  const resp = await fetchWithAuth(`/api/proxy/api/activities?${base}${filters ? `&${filters}` : ""}`);
  return readJson<ActivityListPage>(resp, "list activities");
}

/** The cross-teacher SHARED catalogue (ALS-SHARE M3.2) — every teacher's
 *  `published` activities, owner-labelled for by-owner grouping. Open to any
 *  teacher; read-only (adopt is the only cross-teacher write). */
export async function listSharedCatalogue(params: ActivityFilterParams = {}): Promise<ActivityListPage> {
  const filters = activityFilterQuery(params);
  const resp = await fetchWithAuth(`/api/proxy/api/activities?published=true${filters ? `&${filters}` : ""}`);
  return readJson<ActivityListPage>(resp, "list shared catalogue");
}

/** 1.1.61 — facet options + narrowed counts for the activity library. Same
 *  params as the list, so the rail always describes the set being shown. */
export async function listActivityFacets(
  opts: { scope?: "own" | "all"; published?: boolean } = {},
  params: ActivityFilterParams = {},
): Promise<CurriculumFacets> {
  const base = opts.published ? "published=true" : opts.scope === "all" ? "scope=all" : "owner=me";
  const filters = activityFilterQuery(params);
  const resp = await fetchWithAuth(`/api/proxy/api/activities/facets?${base}${filters ? `&${filters}` : ""}`);
  return readJson<CurriculumFacets>(resp, "list activity facets");
}

/** 1.1.61 — set an activity's OWN facets from the library row.
 *
 *  A PARTIAL patch, deliberately separate from `updateActivity`: that one is a
 *  full overwrite, and the library row holds only a summary (no elements, no
 *  materials). Filing an activity through the full body would send content the
 *  row does not have and wipe it. The backend body is facets-only with
 *  `extra=forbid`, so this cannot express that damage even by mistake. */
export async function patchActivityFacets(
  activityId: string,
  patch: {
    tags?: string[];
    addTags?: string[];
    removeTags?: string[];
    subject?: string | null;
    level?: StxLevel | null;
    clearSubject?: boolean;
    clearLevel?: boolean;
  },
): Promise<ActivityPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/activities/${encodeURIComponent(activityId)}/facets`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return readJson<ActivityPayload>(resp, "update activity facets");
}

/** Set an activity's visibility to any of `draft | private | published` in one
 *  call (ALS-SHARE-UX M1) — the setter behind the card's status control.
 *  `published` lists it in the shared catalogue; already-adopted copies are never
 *  affected. Owner or researcher. */
export async function setActivityVisibility(
  activityId: string,
  visibility: ActivityPayload["visibility"],
): Promise<ActivityPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/activities/${encodeURIComponent(activityId)}/visibility`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
  return readJson<ActivityPayload>(resp, "set activity visibility");
}

/** Adopt a published activity into your library as a fresh `draft` (ALS-SHARE
 *  M3.3) — copy semantics with provenance. Returns the new copy. */
export async function adoptActivity(activityId: string): Promise<ActivityPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/activities/${encodeURIComponent(activityId)}/adopt`, {
    method: "POST",
  });
  return readJson<ActivityPayload>(resp, "adopt activity");
}

export interface TeacherBootstrapResult {
  /** True when this call just seeded the onboarding demo (first sign-in). */
  seeded: boolean;
  classId?: string;
  className?: string;
  activityIds?: string[];
  joinCode?: string | null;
}

/** Seed the teacher's onboarding demo (a Demo class + example activities) on
 *  first app load. Idempotent backend no-op once the teacher owns any class, so
 *  it's safe to call on every mount. */
export async function bootstrapTeacher(): Promise<TeacherBootstrapResult> {
  const resp = await fetchWithAuth(`/api/proxy/api/teacher/bootstrap`, { method: "POST" });
  return readJson<TeacherBootstrapResult>(resp, "teacher bootstrap");
}

/** Duplicate an activity into your library as a fresh `draft` (ALS-SHARE M2) —
 *  source must be your own OR `published`. Returns the new copy. */
export async function duplicateActivity(activityId: string): Promise<ActivityPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/activities/${encodeURIComponent(activityId)}/duplicate`, {
    method: "POST",
  });
  return readJson<ActivityPayload>(resp, "duplicate activity");
}

/** Soft-delete an activity (owner-only). */
export async function deleteActivity(activityId: string): Promise<void> {
  const resp = await fetchWithAuth(`/api/proxy/api/activities/${encodeURIComponent(activityId)}`, {
    method: "DELETE",
  });
  if (!resp.ok && resp.status !== 204) {
    throw new Error(`delete activity: ${resp.status}`);
  }
}

/** Assign / unassign activities to a class (ALS-1 M1). */
export async function patchClassActivities(
  classId: string,
  body: { add?: string[]; remove?: string[] },
): Promise<ClassPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/classes/${encodeURIComponent(classId)}/activities`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<ClassPayload>(resp, "assign activities");
}

/** List the sim-artefact catalogue (1.1.41) — the vetted, pilot-visible sims a
 *  teacher can attach to an activity. `tutorBlock` is never returned. */
export async function listArtefacts(): Promise<ArtefactSummary[]> {
  const resp = await fetchWithAuth(`/api/proxy/api/artefacts?status=live`);
  const data = await readJson<{ artefacts: ArtefactSummary[] }>(resp, "list artefacts");
  return data.artefacts;
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
  opts?: { refresh?: boolean },
): Promise<SessionSummaryPayload> {
  const params = new URLSearchParams();
  if (sessionId) params.set("session_id", sessionId);
  if (opts?.refresh) params.set("refresh", "1"); // force AI-summary regeneration (live drill-down)
  const qs = params.toString() ? `?${params.toString()}` : "";
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
  /** Friendly owner label (display name / email), present only in the
   *  researcher `scope=all` view and only when resolvable; clients fall back
   *  to `ownerUid`. */
  ownerLabel?: string;
  name: string;
  description: string | null;
  tagNamespace: string;
  lessons: string[];
  /** ALS-1 M0/M1 — the class-independent activities (act- ids) this class runs.
   *  Optional in the type (older fixtures omit it); the backend always sends it. */
  activityIds?: string[];
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
  // Don't swallow a load error into an empty list — that renders a backend
  // failure as "no sessions" (fabricated empty state, against the no-mock
  // policy). Throw and let each caller decide how to degrade.
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`list recent sessions failed (${resp.status}): ${text.slice(0, 200)}`);
  }
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

// --- Live class dashboard (1.1.29 + 1.1.31) ---------------------------------

export type LiveCall = {
  groupId: string;
  activityId: string;
  activityTitle: string;
  raisedHandAt: string;
};

export type LiveGroup = {
  groupId: string;
  status: string; // "active" | "idle"
  turns: number;
  lastActivityAt: string;
  idleSeconds: number;
  stuck: boolean;
  activityTitle: string;
  skillId: string;
};

/** The rolling class summary (1.1.31 M1, placeholder framework). Null until wired. */
export type LiveSummary = {
  text: string;
  framework: string;
  generatedAt: string;
};

export type LiveClass = {
  calls: LiveCall[];
  groups: LiveGroup[];
  summary: LiveSummary | null;
  generatedAt: string;
};

/** Live dashboard payload: incoming raised hands + deterministic per-group signals. */
export async function listClassLive(classId: string): Promise<LiveClass> {
  const resp = await fetchWithAuth(`/api/proxy/api/classes/${encodeURIComponent(classId)}/live`);
  if (!resp.ok) throw new Error(`live fetch failed (${resp.status})`);
  return (await resp.json()) as LiveClass;
}

/** Acknowledge (clear) a group's raised hand. */
export async function ackClassSignal(classId: string, groupId: string): Promise<void> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/classes/${encodeURIComponent(classId)}/signals/${encodeURIComponent(groupId)}/ack`,
    { method: "POST" },
  );
  if (!resp.ok) throw new Error(`ack failed (${resp.status})`);
}
