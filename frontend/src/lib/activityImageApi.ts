/**
 * Activity image-material API (1.1.44).
 *
 * A teacher attaches an image to an activity; the tutor SEES it multimodally
 * during the student conversation (it is NOT OCR'd to text — that's the
 * curriculum/RAG path in `curriculumApi.ts`). Teacher-only: the group (student)
 * token would 403, so we use `fetchWithTeacherAuth` (the Firebase teacher token).
 *
 * The endpoint stores the bytes in the activity artifact slot and returns the
 * image `MaterialRef`; the builder adds it to the activity's `materials` on save.
 */

import { fetchWithAuth, fetchWithTeacherAuth } from "@/lib/apiClient";
import type { MaterialRef } from "@/lib/teacherApi";

export class ActivityImageApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ActivityImageApiError";
    this.status = status;
  }
}

/** Upload an image into the activity's slot; returns its image MaterialRef. */
export async function uploadActivityImage(
  activityId: string,
  file: File,
  alt = "",
): Promise<MaterialRef> {
  const form = new FormData();
  form.set("file", file);
  form.set("activityId", activityId);
  if (alt) form.set("alt", alt);

  const resp = await fetchWithTeacherAuth(`/api/proxy/api/activity-images`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    let detail = "Image upload failed.";
    try {
      const body = (await resp.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new ActivityImageApiError(detail, resp.status);
  }
  const body = (await resp.json()) as { materialRef: MaterialRef };
  return body.materialRef;
}

/**
 * Fetch an activity image's bytes (auth-gated) and return an object URL for an
 * `<img src>`. A plain `<img>` can't carry the bearer token, so we fetch with the
 * right helper and wrap the blob. The CALLER must `URL.revokeObjectURL` it on unmount.
 *
 * `role`: "student" (group token, the chat — backend ACLs against the bound
 * activity + studentVisible) or "teacher" (Firebase token, the builder preview).
 */
export async function fetchActivityImageObjectUrl(
  activityId: string,
  materialId: string,
  role: "student" | "teacher" = "student",
): Promise<string> {
  const fetcher = role === "teacher" ? fetchWithTeacherAuth : fetchWithAuth;
  const resp = await fetcher(
    `/api/proxy/api/activity-images/${encodeURIComponent(activityId)}/${encodeURIComponent(materialId)}`,
  );
  if (!resp.ok) {
    throw new ActivityImageApiError("Couldn't load the image.", resp.status);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

/** Remove an image from the activity's slot (idempotent — a 404 is fine). */
export async function deleteActivityImage(activityId: string, materialId: string): Promise<void> {
  const resp = await fetchWithTeacherAuth(
    `/api/proxy/api/activity-images/${encodeURIComponent(activityId)}/${encodeURIComponent(materialId)}`,
    { method: "DELETE" },
  );
  if (!resp.ok && resp.status !== 404) {
    throw new ActivityImageApiError("Couldn't remove the image.", resp.status);
  }
}
