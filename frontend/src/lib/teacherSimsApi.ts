// Teacher-published sims (in-app-sim-authoring M6): publish a checked draft
// version to your own classes, ask for the shared library, withdraw; and, for
// researchers, the library sign-off. Teacher surfaces only (Firebase token).

import { fetchWithTeacherAuth } from "@/lib/apiClient";
import { readJson } from "@/lib/apiResponse";

const BASE = "/api/proxy/api/teacher-sims";

export interface LibraryDecision {
  by: string;
  at: string;
  note: string;
  version: number;
}

export interface TeacherSim {
  id: string;
  displayName: string | null;
  version: number;
  scope: "classes" | "library";
  status: "live" | "withdrawn";
  draftId: string | null;
  draftVersion: number | null;
  approvedBy: string | null;
  approvedAt: string | null;
  libraryRequested: boolean;
  librarySignoff: LibraryDecision | null;
  libraryDeclined: LibraryDecision | null;
  ownerUid?: string | null;
  request?: { note: string; at: string; version: number } | null;
}

/** A refused publish or decision, with the reasons the server gave. */
export class TeacherSimError extends Error {
  constructor(
    message: string,
    readonly reasons: string[],
  ) {
    super(message);
  }
}

async function post<T>(url: string, body: unknown, what: string): Promise<T> {
  const resp = await fetchWithTeacherAuth(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!resp.ok) {
    let reasons: string[] = [];
    try {
      const detail = (await resp.json())?.detail;
      if (Array.isArray(detail?.reasons)) reasons = detail.reasons.map(String);
      else if (typeof detail === "string") reasons = [detail];
    } catch {
      /* no body */
    }
    throw new TeacherSimError(`${what}: ${resp.status}`, reasons);
  }
  return (await resp.json()) as T;
}

export async function publishSimVersion(
  draftId: string,
  version: number,
): Promise<TeacherSim> {
  const out = await post<{ published: TeacherSim }>(
    `/api/proxy/api/sim-drafts/${encodeURIComponent(draftId)}/versions/${version}/publish`,
    { approve: true },
    "publish sim",
  );
  return out.published;
}

export async function listMyTeacherSims(): Promise<TeacherSim[]> {
  return (
    await readJson<{ sims: TeacherSim[] }>(
      await fetchWithTeacherAuth(`${BASE}/mine`),
      "load published sims",
    )
  ).sims;
}

export async function requestLibrary(
  simId: string,
  note: string,
): Promise<TeacherSim> {
  return (
    await post<{ sim: TeacherSim }>(
      `${BASE}/${encodeURIComponent(simId)}/library-request`,
      { note },
      "ask for the library",
    )
  ).sim;
}

export async function withdrawTeacherSim(simId: string): Promise<TeacherSim> {
  return (
    await post<{ sim: TeacherSim }>(
      `${BASE}/${encodeURIComponent(simId)}/withdraw`,
      {},
      "withdraw sim",
    )
  ).sim;
}

export async function listLibraryRequests(): Promise<TeacherSim[]> {
  return (
    await readJson<{ requests: TeacherSim[] }>(
      await fetchWithTeacherAuth(`${BASE}/review`),
      "load library requests",
    )
  ).requests;
}

export async function decideLibrary(
  simId: string,
  approve: boolean,
  note: string,
): Promise<TeacherSim> {
  return (
    await post<{ sim: TeacherSim }>(
      `${BASE}/${encodeURIComponent(simId)}/library-decision`,
      { approve, note },
      "library decision",
    )
  ).sim;
}
