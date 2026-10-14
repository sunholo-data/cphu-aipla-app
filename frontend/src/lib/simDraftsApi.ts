// The teacher's sim drafts from the sim-author skill (in-app-sim-authoring M4).
// Teacher-auth only: GET /api/sim-drafts (backend protocols/sim_draft_routes.py).
// Screenshots and files come back as blobs; the draft HTML is downloaded, never
// rendered on this origin.

import { fetchWithTeacherAuth } from "@/lib/apiClient";
import { readJson } from "@/lib/apiResponse";

const BASE = "/api/proxy/api/sim-drafts";

/** What building this sim has cost so far: every model call's tokens, priced
 *  with the platform's rate card. A rough guide, not an invoice. */
export interface SimDraftUsage {
  tokensIn: number;
  tokensOut: number;
  tokensThinking: number;
  costUsd: number;
  calls: number;
}

export interface SimDraftSummary {
  id: string;
  title: string | null;
  latestVersion: number | null;
  latestLevel: number | null;
  artefactId: string | null;
  updatedAt: string | null;
  usage?: SimDraftUsage | null;
  /** The assistant conversation this draft was built in; reopen it to carry on. */
  sessionId: string;
}

export interface SimDraftVersion {
  version: number;
  level: number | null;
  reasons: string[];
  createdAt: string | null;
  screenshots: string[];
}

export interface SimDraft {
  id: string;
  title: string | null;
  artefactId: string | null;
  usage?: SimDraftUsage | null;
  sessionId: string;
  versions: SimDraftVersion[];
}

export async function listSimDrafts(): Promise<SimDraftSummary[]> {
  const body = await readJson<{ drafts: SimDraftSummary[] }>(
    await fetchWithTeacherAuth(BASE),
    "load sim drafts",
  );
  return body.drafts;
}

export async function getSimDraft(id: string): Promise<SimDraft> {
  return readJson<SimDraft>(
    await fetchWithTeacherAuth(`${BASE}/${encodeURIComponent(id)}`),
    "load sim draft",
  );
}

async function blobOf(path: string, what: string): Promise<Blob> {
  const resp = await fetchWithTeacherAuth(`${BASE}/${path}`);
  if (!resp.ok) throw new Error(`${what}: ${resp.status}`);
  return resp.blob();
}

export function fetchSimScreenshot(
  id: string,
  version: number,
  shot: string,
): Promise<Blob> {
  return blobOf(
    `${encodeURIComponent(id)}/versions/${version}/screenshot/${encodeURIComponent(shot)}`,
    "load screenshot",
  );
}

/** A version's page with the real bridge stamped in, for the live preview. */
export function fetchSimPreview(id: string, version: number): Promise<Blob> {
  return blobOf(
    `${encodeURIComponent(id)}/versions/${version}/preview`,
    "load preview",
  );
}

export function fetchSimFile(
  id: string,
  version: number,
  name: "index.html" | "catalogue.yaml" | "portable.html",
): Promise<Blob> {
  return blobOf(
    `${encodeURIComponent(id)}/versions/${version}/files/${name}`,
    "download file",
  );
}

export interface SimImportResult {
  draftId: string;
  version: number;
  level: number;
  reasons: string[];
}

/** Bring a sim made elsewhere in as a new draft: a portable .html (catalogue
 *  inside), or a page plus its catalogue entry. Checked like any version; the
 *  page is sent as text and never rendered on this origin. */
export async function importSimDraft(
  html: string,
  yaml?: string | null,
): Promise<SimImportResult> {
  const res = await fetchWithTeacherAuth(`${BASE}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, yaml: yaml ?? null }),
  });
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as {
      detail?: { reason?: string };
    };
    throw new Error(body.detail?.reason ?? "not importable");
  }
  return readJson<SimImportResult>(res, "import sim");
}

