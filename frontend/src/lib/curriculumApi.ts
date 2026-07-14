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
  /** 1.1.58 M1 — freeform tags (canonical: lowercased). Searchable + facet chips. */
  tags: string[];
  /** 1.1.58 M2 — coarse subject facet (soft vocab, display-cased). */
  subject: string | null;
  /** 1.1.58 M3 — flat folder membership (denormalised id + name). */
  folderId: string | null;
  folderName: string | null;
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
  /** 1.1.58 M1 — AND facet: only docs carrying every tag. */
  tags?: string[];
  /** 1.1.58 M2 — exact-match subject facet. */
  subject?: string;
  /** 1.1.58 M3 — exact-match folder facet (folder id). */
  folder?: string;
  scope?: "shared" | "mine";
  /** 1.1.59 — pagination. `limit` caps at 200 server-side (default 50). */
  limit?: number;
  offset?: number;
}

/** A page of the curriculum library. `total` is the full match count (for
 *  "Showing X of Y"); `docs` is the requested slice. */
export interface CurriculumPage {
  docs: CurriculumDoc[];
  total: number;
  limit: number;
  offset: number;
}

/** Browse the curriculum library, ACL-scoped to the current teacher (1.1.59:
 *  paginated). Returns the page + `total` so callers can render "X of Y". */
export async function browseCurriculum(
  params: BrowseCurriculumParams = {},
): Promise<CurriculumPage> {
  const qs = new URLSearchParams();
  if (params.level) qs.set("level", params.level);
  if (params.topic) qs.set("topic", params.topic);
  if (params.tags) for (const t of params.tags) qs.append("tags", t);
  if (params.subject) qs.set("subject", params.subject);
  if (params.folder) qs.set("folder", params.folder);
  if (params.scope) qs.set("scope", params.scope);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const resp = await fetchWithTeacherAuth(`/api/proxy/api/curriculum${suffix}`);
  const body = await readJson<{ docs: CurriculumDoc[]; total?: number; limit?: number; offset?: number }>(
    resp,
    "browse curriculum",
  );
  return {
    docs: body.docs,
    total: body.total ?? body.docs.length,
    limit: body.limit ?? params.limit ?? body.docs.length,
    offset: body.offset ?? params.offset ?? 0,
  };
}

/** Distinct facet vocabularies (tags + subjects) across the docs this teacher can
 *  see — populates facet chips (1.1.58 M1/M2). */
export async function listCurriculumFacets(
  scope?: "shared" | "mine",
): Promise<{ tags: string[]; subjects: string[] }> {
  const suffix = scope ? `?scope=${scope}` : "";
  const resp = await fetchWithTeacherAuth(`/api/proxy/api/curriculum/facets${suffix}`);
  const body = await readJson<{ tags: string[]; subjects?: string[] }>(resp, "load curriculum facets");
  return { tags: body.tags, subjects: body.subjects ?? [] };
}

/** A flat curriculum folder (1.1.58 M3), with a live doc count. */
export interface CurriculumFolder {
  folderId: string;
  name: string;
  ownerScope: string;
  docCount: number;
}

/** List the folders this teacher can see (shared + own), each with a doc count. */
export async function listCurriculumFolders(
  scope?: "shared" | "mine",
): Promise<CurriculumFolder[]> {
  const suffix = scope ? `?scope=${scope}` : "";
  const resp = await fetchWithTeacherAuth(`/api/proxy/api/curriculum/folders${suffix}`);
  const body = await readJson<{ folders: CurriculumFolder[] }>(resp, "load curriculum folders");
  return body.folders;
}

/** Create a flat folder. `shared` puts it in the shared corpus (admin). */
export async function createCurriculumFolder(
  name: string,
  shared = false,
): Promise<CurriculumFolder> {
  const resp = await fetchWithTeacherAuth(`/api/proxy/api/curriculum/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, shared }),
  });
  const body = await readJson<{ folder: CurriculumFolder }>(resp, "create curriculum folder");
  return body.folder;
}

/** Delete a folder (1.1.58 M5). Its docs are UNFILED, not deleted. Returns the
 *  count of docs unfiled. */
export async function deleteCurriculumFolder(folderId: string): Promise<{ deleted: string; unfiled: number }> {
  const resp = await fetchWithTeacherAuth(`/api/proxy/api/curriculum/folders/${encodeURIComponent(folderId)}`, {
    method: "DELETE",
  });
  return readJson<{ deleted: string; unfiled: number }>(resp, "delete curriculum folder");
}

/** Edit a doc's facets (1.1.58 M1/M2/M3). Tags: a full `tags` replacement or
 *  `addTags`/`removeTags` deltas. `subject`/`folderId`: sending it (even null)
 *  sets/clears it. Returns the updated doc (facets normalised server-side). */
export async function patchCurriculumTags(
  docId: string,
  body: { tags?: string[]; addTags?: string[]; removeTags?: string[]; subject?: string | null; folderId?: string | null },
): Promise<CurriculumDoc> {
  const resp = await fetchWithTeacherAuth(
    `/api/proxy/api/curriculum/${encodeURIComponent(docId)}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  const parsed = await readJson<{ doc: CurriculumDoc }>(resp, "update curriculum tags");
  return parsed.doc;
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
