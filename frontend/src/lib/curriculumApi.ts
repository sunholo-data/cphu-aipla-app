/**
 * Curriculum-library API client (1.1.25 M4).
 *
 * Wraps the two teacher-facing endpoints behind the Next proxy:
 *   GET  /api/curriculum            — browse the library (ACL: shared + own)
 *   POST /api/curriculum/ingest     — upload a doc (AILANG Parse → RAG corpus)
 *
 * Both are teacher-only (anonymous-group students get 403). Every call uses
 * the Firebase teacher token via `fetchWithTeacherAuth`.
 */

import { fetchWithTeacherAuth as fetchWithAuth } from "@/lib/apiClient";
import type { StxLevel } from "@/lib/teacherApi";

/** One curriculum document's metadata (mirrors backend CurriculumDoc). */
export interface CurriculumDoc {
  docId: string;
  title: string;
  level: StxLevel;
  topic: string | null;
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
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new CurriculumApiError(`${errMsg}: ${resp.status} ${body.slice(0, 200)}`, resp.status);
  }
  return (await resp.json()) as T;
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
  const resp = await fetchWithAuth(`/api/proxy/api/curriculum${suffix}`);
  const body = await readJson<{ docs: CurriculumDoc[] }>(resp, "browse curriculum");
  return body.docs;
}

export interface IngestCurriculumParams {
  file: File;
  title: string;
  level: StxLevel;
  origin: string;
  topic?: string;
  /** Teacher uploads default to teacher_owned (un-gated). Shared ingestion
   *  is admin-only and requires copyright_status=cleared — not exposed here. */
}

/** Ingest a teacher's own document into the library (teacher_owned). */
export async function ingestCurriculum(
  params: IngestCurriculumParams,
): Promise<CurriculumDoc> {
  const form = new FormData();
  form.set("file", params.file);
  form.set("title", params.title);
  form.set("level", params.level);
  form.set("origin", params.origin);
  if (params.topic) form.set("topic", params.topic);
  // shared=false, copyright_status=teacher_owned are the backend defaults.

  const resp = await fetchWithAuth(`/api/proxy/api/curriculum/ingest`, {
    method: "POST",
    body: form,
  });
  const body = await readJson<{ doc: CurriculumDoc }>(resp, "ingest curriculum");
  return body.doc;
}
