/**
 * Lesson-transcript fetch (REC-TRANSCRIPT M3/M4). The transcript is keyed by the
 * group; the student reads their OWN group's via `/me/transcript` (no group id
 * on the wire), the teacher reads a specific group's via `/group/{id}/transcript`.
 */

import { fetchWithAuth } from "@/lib/apiClient";

export interface TranscriptSegment {
  seq: number;
  text: string;
  createdAt: string;
}

export interface GroupTranscript {
  groupId: string;
  segments: TranscriptSegment[];
  text: string;
}

async function _fetch(url: string): Promise<GroupTranscript | null> {
  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) return null;
    return (await res.json()) as GroupTranscript;
  } catch {
    return null;
  }
}

/** The student's own group's lesson transcript (null on error / no access). */
export function fetchMyTranscript(): Promise<GroupTranscript | null> {
  return _fetch("/api/proxy/api/voice/recording/me/transcript");
}

/** A specific group's transcript (teacher report). */
export function fetchGroupTranscript(groupId: string): Promise<GroupTranscript | null> {
  return _fetch(`/api/proxy/api/voice/recording/group/${encodeURIComponent(groupId)}/transcript`);
}
