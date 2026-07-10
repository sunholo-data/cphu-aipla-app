/**
 * Curriculum-library API client (1.1.25 M4).
 *
 * Behind the Next proxy:
 *   GET  /api/curriculum            — browse the library (teacher-only)
 *   POST /api/curriculum/ingest     — upload a doc (teacher-only)
 *   GET  /api/curriculum/{id}/content — read parsed text (DUAL-audience)
 *
 * Browse + ingest are teacher-only (Firebase token via `fetchWithTeacherAuth`).
 * The content endpoint serves BOTH a teacher (own/shared docs) AND a student
 * (anonymous-group token, ACL'd to a cited + student-visible doc in their active
 * activity) — so its caller picks the auth via `opts.as`. A student using the
 * teacher token would 401 (no Firebase identity); see fetchCurriculumContent.
 */

import { fetchWithAuth, fetchWithTeacherAuth } from "@/lib/apiClient";
import { readJson as sharedReadJson } from "@/lib/apiResponse";
import type { StxLevel } from "@/lib/teacherApi";

/** One curriculum document's metadata (mirrors backend CurriculumDoc). */
export interface CurriculumDoc {
  docId: string;
  title: string;
  /** 1.1.33: optional. Shared cleared library docs carry A/B/C; ad-hoc teacher
   *  uploads are level-less (null) unless a level is later assigned. */
  level: StxLevel | null;
  topic: string | null;
  /** 1.1.52 — a 1–2 sentence catalogue blurb generated at ingest. "" until the
   *  `summarize` backfill runs on older docs. */
  summary: string;
  source: "shared" | "teacher_upload";
  ownerScope: string;
  origin: string;
  docArtifactId: string;
  copyrightStatus: "cleared" | "teacher_owned" | "pending";
  createdAt: string;
  updatedAt: string;
}

export class CurriculumApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CurriculumApiError";
    this.status = status;
  }
}

async function readJson<T>(resp: Response, errMsg: string): Promise<T> {
  return sharedReadJson<T>(resp, errMsg, {
    toError: ({ status, body, message }) =>
      new CurriculumApiError(`${message}: ${status} ${body.slice(0, 200)}`, status),
  });
}

export interface BrowseCurriculumParams {
  level?: StxLevel;
  topic?: string;
  scope?: "shared" | "mine";
}

/** Browse the curriculum library, ACL-scoped to the current teacher. */
export async function browseCurriculum(
  params: BrowseCurriculumParams = {},
): Promise<CurriculumDoc[]> {
  const qs = new URLSearchParams();
  if (params.level) qs.set("level", params.level);
  if (params.topic) qs.set("topic", params.topic);
  if (params.scope) qs.set("scope", params.scope);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const resp = await fetchWithTeacherAuth(`/api/proxy/api/curriculum${suffix}`);
  const body = await readJson<{ docs: CurriculumDoc[] }>(resp, "browse curriculum");
  return body.docs;
}

export interface IngestCurriculumParams {
  file: File;
  title: string;
  /** 1.1.33: optional — uploads are level-less unless the teacher assigns one. */
  level?: StxLevel;
  origin: string;
  topic?: string;
  /** Teacher uploads default to teacher_owned (un-gated). Shared ingestion
   *  is admin-only and requires copyright_status=cleared — not exposed here. */
}

/** The ingest result. 1.1.33 M4 — `parsedPreview` is what AILANG Parse
 *  extracted (capped; `parsedChars` is the full length), returned so the
 *  teacher can verify the parse before it grounds the tutor. */
export interface IngestResult {
  doc: CurriculumDoc;
  parsedPreview: string;
  parsedChars: number;
}

/** Ingest a teacher's own document into the library (teacher_owned). */
export async function ingestCurriculum(
  params: IngestCurriculumParams,
): Promise<IngestResult> {
  const form = new FormData();
  form.set("file", params.file);
  form.set("title", params.title);
  if (params.level) form.set("level", params.level);
  form.set("origin", params.origin);
  if (params.topic) form.set("topic", params.topic);
  // shared=false, copyright_status=teacher_owned are the backend defaults.

  const resp = await fetchWithTeacherAuth(`/api/proxy/api/curriculum/ingest`, {
    method: "POST",
    body: form,
  });
  const body = await readJson<{
    doc: CurriculumDoc;
    parsedPreview?: string;
    parsedChars?: number;
  }>(resp, "ingest curriculum");
  return {
    doc: body.doc,
    parsedPreview: body.parsedPreview ?? "",
    parsedChars: body.parsedChars ?? 0,
  };
}

/** A doc's parsed content for display (1.1.33 M3). `available` is false when no
 *  content was stored (doc ingested before M3 — re-upload to view). */
export interface DocContent {
  docId: string;
  title: string;
  available: boolean;
  text: string;
  chars: number;
}

/** Fetch a curriculum doc's parsed text for display. `activityId` is required
 *  for the student path (ACL: the doc must be cited + student-visible in their
 *  active activity); teachers omit it (read their own / shared).
 *
 *  `opts.as` selects the auth token: `"student"` sends the anonymous-group token
 *  (the workbench viewer), `"teacher"` (default) sends the Firebase token (the
 *  activity editor). Sending the wrong one 401s — a student has no Firebase
 *  identity, a teacher has no group session. */
export async function fetchCurriculumContent(
  docId: string,
  activityId?: string,
  opts: { as?: "teacher" | "student" } = {},
): Promise<DocContent> {
  const qs = activityId ? `?activityId=${encodeURIComponent(activityId)}` : "";
  const doFetch = opts.as === "student" ? fetchWithAuth : fetchWithTeacherAuth;
  const resp = await doFetch(
    `/api/proxy/api/curriculum/${encodeURIComponent(docId)}/content${qs}`,
  );
  return readJson<DocContent>(resp, "load document content");
}
