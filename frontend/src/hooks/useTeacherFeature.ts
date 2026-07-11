"use client";

// Tri-state feature gating (1.1.58 / SETTINGS-1) — the graduation path for
// build-time dark flags:
//   '1'    -> on for everyone (dev's standing state)
//   'beta' -> shipped in the bundle, visible only to teachers who opted in
//             (teacher_prefs.features[key]) — visibility gating, NOT secrecy
//   ''     -> off for everyone
//
// The prefs fetch happens ONLY in the 'beta' state, so '1'/'' cost nothing.

import { useEffect, useState } from "react";

import { fetchWithTeacherAuth } from "@/lib/apiClient";

export function useTeacherFeature(key: string, buildValue: string | undefined): boolean {
  const isBeta = buildValue === "beta";
  const [optedIn, setOptedIn] = useState(false);

  useEffect(() => {
    if (!isBeta) return;
    let alive = true;
    fetchWithTeacherAuth("/api/proxy/api/teacher/prefs")
      .then((r) => (r.ok ? r.json() : {}))
      .then((prefs: { features?: Record<string, boolean> }) => {
        if (alive) setOptedIn(!!prefs?.features?.[key]);
      })
      .catch(() => {
        /* degrade to not-opted-in */
      });
    return () => {
      alive = false;
    };
  }, [isBeta, key]);

  if (buildValue === "1") return true;
  if (isBeta) return optedIn;
  return false;
}
