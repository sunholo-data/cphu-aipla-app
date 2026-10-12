/**
 * Student-side shared-session API (1.1.145 M1).
 *
 * Uses `fetchWithAuth` — the **group** (anonymous-student) token. The backend
 * keys the session off the token's group, so a student can only ever resolve
 * their own group's conversation.
 */

import { fetchWithAuth } from "@/lib/apiClient";

export interface GroupSession {
  sessionId: string;
  /** True only for the call that minted it: the chat page greets on a created
   *  session and restores workbench state on an existing one. */
  created: boolean;
}

/** THE shared session for this group on this activity — the server decides.
 *
 * A transactional create-if-absent on the backend, so every device that opens
 * the activity, however simultaneously, gets the same id. `activityId` is the
 * `act-…` id; a legacy lesson passes its skill id (the backend scopes it by the
 * skill either way). */
export async function resolveGroupSession(
  skillId: string,
  activityId: string,
): Promise<GroupSession> {
  const resp = await fetchWithAuth("/api/proxy/api/auth/group/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skillId, activityId }),
  });
  if (!resp.ok) throw new Error(`group session failed: ${resp.status}`);
  const data = (await resp.json()) as { sessionId?: string; created?: boolean };
  if (!data.sessionId) throw new Error("group session failed: no sessionId");
  return { sessionId: data.sessionId, created: Boolean(data.created) };
}
