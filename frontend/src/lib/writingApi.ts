/** Student writing element — load/save the group's text (1.1.73).
 *
 *  `fetchWithAuth` (the GROUP token), NOT `fetchWithTeacherAuth`: this is a
 *  student workspace surface, and a student calling a teacher-auth helper sends
 *  a null token and gets a 401. The eslint `no-restricted-imports` fence over
 *  `components/workspace` enforces the same thing structurally.
 */

import { fetchWithAuth } from "@/lib/apiClient";

/** One writing element's stored text for this group. */
export interface WritingDoc {
  text: string;
  words: number;
  /** Monotonic; a jump means another group member saved from another device. */
  revision: number;
  updatedAt: string;
}

/** Fetch every writing element's text for this group + activity. Returns `{}`
 *  on any failure — an unreachable store must leave the student able to type,
 *  not staring at an error where their work should be (Axiom 5). The caller
 *  shows the unsaved state; it never silently pretends the save worked. */
export async function fetchWriting(activityId: string): Promise<Record<string, WritingDoc>> {
  try {
    const resp = await fetchWithAuth(`/api/proxy/api/activities/${encodeURIComponent(activityId)}/writing`);
    if (!resp.ok) return {};
    const body = await resp.json();
    const docs = body?.docs;
    return docs && typeof docs === "object" ? (docs as Record<string, WritingDoc>) : {};
  } catch {
    return {};
  }
}

/** Save one element's text. Sends the WHOLE text, never a diff — so a retried
 *  or out-of-order save can only ever land a whole document. Rejects on a
 *  non-2xx so the caller can show "ikke gemt" rather than a false "gemt". */
export async function saveWriting(activityId: string, elementId: string, text: string): Promise<WritingDoc> {
  const resp = await fetchWithAuth(`/api/proxy/api/activities/${encodeURIComponent(activityId)}/writing`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ elementId, text }),
  });
  if (!resp.ok) throw new Error(`writing save failed: ${resp.status}`);
  return (await resp.json()) as WritingDoc;
}
