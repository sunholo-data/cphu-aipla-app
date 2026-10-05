/**
 * Teacher privacy notice (KU legal, 2026-10-05).
 *
 * Teachers must be informed in writing how their data is handled before using
 * the platform. The backend records who acknowledged which notice version and
 * when (`db/privacy_ack.py`); `PrivacyNoticeGate` shows the notice until then.
 */
import { fetchWithTeacherAuth } from "@/lib/apiClient";

export interface PrivacyNoticeStatus {
  version: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export async function getPrivacyNotice(): Promise<PrivacyNoticeStatus> {
  const resp = await fetchWithTeacherAuth("/api/proxy/api/teacher/privacy-notice");
  if (!resp.ok) throw new Error(`privacy-notice ${resp.status}`);
  return (await resp.json()) as PrivacyNoticeStatus;
}

export async function acknowledgePrivacyNotice(version: string): Promise<PrivacyNoticeStatus> {
  const resp = await fetchWithTeacherAuth("/api/proxy/api/teacher/privacy-notice/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
  if (!resp.ok) throw new Error(`privacy-notice ack ${resp.status}`);
  return (await resp.json()) as PrivacyNoticeStatus;
}
