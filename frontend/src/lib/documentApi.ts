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
 *  telemetry — captured server-side; NOT a tutor-context write or a proactive
 *  trigger (the reactability ranking is a separate design doc). */
export interface DocumentEvent {
  kind: "document.open" | "document.page" | "image.zoom" | "image.fullscreen";
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
