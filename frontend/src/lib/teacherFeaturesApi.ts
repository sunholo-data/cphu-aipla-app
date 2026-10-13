// Which per-teacher features the signed-in teacher has (2026-10-13).
// GET /api/teacher/features (backend protocols/teacher_features_routes.py).
// Researchers have every feature; teachers have what a researcher switched on.

import { fetchWithTeacherAuth } from "@/lib/apiClient";
import { readJson } from "@/lib/apiResponse";

export interface MyFeatures {
  features: Record<string, boolean>;
  researcher: boolean;
}

export async function fetchMyFeatures(): Promise<MyFeatures> {
  return readJson<MyFeatures>(await fetchWithTeacherAuth("/api/proxy/api/teacher/features"), "load features");
}
