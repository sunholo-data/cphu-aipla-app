/**
 * Document raw-bytes API (1.1.45 M2). Fetches a document's ORIGINAL file bytes
 * (e.g. the real PDF) for the workbench viewer, auth-gated. A plain `<embed>`/
 * `<img>` can't carry the bearer token, so we fetch with the right helper and
 * wrap the blob in an object URL — the CALLER must `URL.revokeObjectURL` it.
 *
 * `role`: "student" (group token) or "teacher" (Firebase token). The backend
 * owner-ACLs the document either way (the uploader is the owner).
 */

import { fetchWithAuth, fetchWithTeacherAuth } from "@/lib/apiClient";

export class DocumentApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DocumentApiError";
    this.status = status;
  }
}

/** A student document/image interaction (1.1.45 M5). Observational research
 *  telemetry — captured server-side **for records only**; NEVER a tutor-context
 *  write or a proactive trigger (the reactability ranking is a separate doc).
 *
 *  Privacy default: `detail` carries SIZE/POSITION (char counts, percent, page)
 *  — NOT the copied/selected TEXT itself. Capturing content is a consent-gated
 *  extension for the research-telemetry design doc. */
export interface DocumentEvent {
  kind:
    | "document.open"
    | "document.page"
    | "document.scroll"
    | "document.select"
    | "document.copy"
    | "image.zoom"
    | "image.fullscreen";
  docId?: string;
  materialId?: string;
  detail?: unknown;
}

/** Fire-and-forget a document interaction event for research capture. No-op
 *  without a session (e.g. the builder preview). Never throws — telemetry must
 *  not break the workbench. */
export function reportDocumentEvent(sessionId: string | null | undefined, event: DocumentEvent): void {
  if (!sessionId) return;
  void fetchWithAuth(`/api/proxy/api/sessions/${encodeURIComponent(sessionId)}/doc-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => {
    /* telemetry is best-effort */
  });
}

/** Fetch a document's original bytes as an object URL (revoke it on unmount). */
export async function fetchDocumentObjectUrl(
  docId: string,
  role: "student" | "teacher" = "student",
): Promise<string> {
  const fetcher = role === "teacher" ? fetchWithTeacherAuth : fetchWithAuth;
  const resp = await fetcher(`/api/proxy/api/documents/${encodeURIComponent(docId)}/raw`);
  if (!resp.ok) {
    throw new DocumentApiError("Couldn't load the document file.", resp.status);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

/** One of the caller's own uploads for an activity (1.1.45 M3b). The list is
 *  owner-ACL'd server-side: a student sees the group's uploads (group-owned via
 *  `anon-<groupId>`), a teacher their own (builder preview). */
export interface MyDocument {
  docId: string;
  name: string;
  /** AILANG source format ("pdf", "docx", …); "" when unknown. */
  sourceFormat: string;
}

function fetcherFor(role: "student" | "teacher") {
  return role === "teacher" ? fetchWithTeacherAuth : fetchWithAuth;
}

/** List the caller's uploaded documents for an activity (file tabs). Scoped by
 *  `skillId` so one activity's workbench never shows another's files. */
export async function listMyDocuments(
  skillId: string,
  role: "student" | "teacher" = "student",
): Promise<MyDocument[]> {
  const resp = await fetcherFor(role)(
    `/api/proxy/api/documents?skillId=${encodeURIComponent(skillId)}`,
  );
  if (!resp.ok) {
    throw new DocumentApiError("Couldn't list your documents.", resp.status);
  }
  const data = (await resp.json()) as { documents?: MyDocument[] };
  return data.documents ?? [];
}

/** Upload one document for an activity; resolves with its new docId. Reuses the
 *  shared 1.1.7 upload → AILANG Parse → `parsed_documents` path, group-owned. */
export async function uploadDocument(
  file: File,
  skillId: string,
  role: "student" | "teacher" = "student",
): Promise<{ docId: string; name: string }> {
  const body = new FormData();
  body.append("file", file);
  if (skillId) body.append("skill_id", skillId);
  // No explicit Content-Type — the browser sets the multipart boundary.
  const resp = await fetcherFor(role)(`/api/proxy/api/documents/upload`, { method: "POST", body });
  if (!resp.ok) {
    throw new DocumentApiError("Couldn't upload that file.", resp.status);
  }
  const data = (await resp.json()) as { docId?: string };
  if (!data.docId) {
    throw new DocumentApiError("Upload returned no document id.", resp.status);
  }
  return { docId: data.docId, name: file.name };
}

/** Hard-delete one of the caller's documents (owner-ACL'd). */
export async function deleteDocument(
  docId: string,
  role: "student" | "teacher" = "student",
): Promise<void> {
  const resp = await fetcherFor(role)(
    `/api/proxy/api/documents/${encodeURIComponent(docId)}`,
    { method: "DELETE" },
  );
  // 204 on success; 404 means it's already gone — treat as success (idempotent).
  if (!resp.ok && resp.status !== 404) {
    throw new DocumentApiError("Couldn't delete that document.", resp.status);
  }
}
