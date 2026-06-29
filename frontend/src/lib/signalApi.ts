/**
 * Student-side live-signal API (1.1.29 call-teacher).
 *
 * Uses `fetchWithAuth` — the **group** (anonymous-student) token — because these
 * are student-session writes. The backend keys the signal off the session's
 * group_id, so a student can only raise their own group's hand. (Teacher reads/
 * acks live in `teacherApi.ts` and use the Firebase teacher token.)
 */

import { fetchWithAuth } from "@/lib/apiClient";

export type GroupSignalState = {
  raised: boolean;
  raisedHandAt: string | null;
  clearedAt: string | null;
  clearedBy: string;
  activityTitle: string;
};

const BASE = "/api/proxy/api/auth/group";

export async function raiseHand(activityTitle = ""): Promise<GroupSignalState> {
  const resp = await fetchWithAuth(`${BASE}/raise-hand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activityTitle }),
  });
  if (!resp.ok) throw new Error(`raise-hand failed: ${resp.status}`);
  return resp.json() as Promise<GroupSignalState>;
}

export async function lowerHand(): Promise<GroupSignalState> {
  const resp = await fetchWithAuth(`${BASE}/lower-hand`, { method: "POST" });
  if (!resp.ok) throw new Error(`lower-hand failed: ${resp.status}`);
  return resp.json() as Promise<GroupSignalState>;
}

export async function getGroupSignal(): Promise<GroupSignalState> {
  const resp = await fetchWithAuth(`${BASE}/signal`);
  if (!resp.ok) throw new Error(`get signal failed: ${resp.status}`);
  return resp.json() as Promise<GroupSignalState>;
}
