// The teacher's sim drafts from the sim-author skill (in-app-sim-authoring M4).
// Teacher-auth only: GET /api/sim-drafts (backend protocols/sim_draft_routes.py).
// Screenshots and files come back as blobs; the draft HTML is downloaded, never
// rendered on this origin.

import { fetchWithTeacherAuth } from "@/lib/apiClient";
import { readJson } from "@/lib/apiResponse";

const BASE = "/api/proxy/api/sim-drafts";

export interface SimDraftSummary {
  id: string;
  title: string | null;
  latestVersion: number | null;
  latestLevel: number | null;
  artefactId: string | null;
  updatedAt: string | null;
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
  versions: SimDraftVersion[];
}

export async function listSimDrafts(): Promise<SimDraftSummary[]> {
  const body = await readJson<{ drafts: SimDraftSummary[] }>(await fetchWithTeacherAuth(BASE), "load sim drafts");
  return body.drafts;
}

export async function getSimDraft(id: string): Promise<SimDraft> {
  return readJson<SimDraft>(await fetchWithTeacherAuth(`${BASE}/${encodeURIComponent(id)}`), "load sim draft");
}

async function blobOf(path: string, what: string): Promise<Blob> {
  const resp = await fetchWithTeacherAuth(`${BASE}/${path}`);
  if (!resp.ok) throw new Error(`${what}: ${resp.status}`);
  return resp.blob();
}

export function fetchSimScreenshot(id: string, version: number, shot: string): Promise<Blob> {
  return blobOf(`${encodeURIComponent(id)}/versions/${version}/screenshot/${encodeURIComponent(shot)}`, "load screenshot");
}

export function fetchSimFile(id: string, version: number, name: "index.html" | "catalogue.yaml"): Promise<Blob> {
  return blobOf(`${encodeURIComponent(id)}/versions/${version}/files/${name}`, "download file");
}
