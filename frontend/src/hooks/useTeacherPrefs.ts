"use client";

// Teacher account defaults (1.1.58 / SETTINGS-1) — one GET on mount, partial
// PUTs on save, optimistic local state. Unset/unreachable prefs read as {}
// so every consumer degrades to today's behaviour (the design's rule).

import { useCallback, useEffect, useState } from "react";

import { fetchWithTeacherAuth } from "@/lib/apiClient";

export interface TeacherPrefs {
  defaultLanguage?: "da" | "en" | null;
  defaultPersonaId?: string | null;
  features?: Record<string, boolean> | null;
}

/** Seed the builder's language from the account default — CREATE-time only,
 *  and only while the form is untouched (the anti-fight rule: an explicit
 *  choice or a hydrated existing activity is never overridden). Returns the
 *  language to set, or null when seeding must not apply. */
export function languageSeed(
  prefs: TeacherPrefs,
  form: { language: string; title: string; teachingGoal: string },
): "da" | "en" | null {
  if (!prefs.defaultLanguage) return null;
  const untouched = form.language === "da" && !form.title.trim() && !form.teachingGoal.trim();
  return untouched && prefs.defaultLanguage !== form.language ? prefs.defaultLanguage : null;
}

export function useTeacherPrefs() {
  const [prefs, setPrefs] = useState<TeacherPrefs>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchWithTeacherAuth("/api/proxy/api/teacher/prefs")
      .then((r) => (r.ok ? r.json() : {}))
      .then((body) => {
        if (!alive) return;
        setPrefs(body ?? {});
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true); // degrade to defaults, don't block the UI
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Partial update — optimistic; the server merge is authoritative on success. */
  const save = useCallback(async (updates: TeacherPrefs): Promise<boolean> => {
    setPrefs((cur) => ({ ...cur, ...updates }));
    try {
      const res = await fetchWithTeacherAuth("/api/proxy/api/teacher/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return false;
      setPrefs((await res.json()) as TeacherPrefs);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { prefs, loaded, save };
}
