import { useEffect, useState } from "react";

import { fetchWithTeacherAuth } from "@/lib/apiClient";

const PLATFORM_OWNER_ID = "aipla-platform";

export interface SkillSlugResolution {
  /** The resolved Firestore UUID, or null while loading / on error. */
  skillId: string | null;
  /** A human-readable error, or null while loading / on success. */
  resolveError: string | null;
}

/**
 * Resolve a platform skill's stable slug to its per-environment Firestore
 * UUID. The AG-UI stream endpoint (`/api/skill/{id}/stream`) keys on the UUID,
 * not the slug — so every teacher chat island must resolve first or the stream
 * POST 404s ("Skill not found"). All three teacher islands (analytics-chat,
 * manage-class, the authoring co-pilot) hit the same
 * `/api/skills/by-slug/<owner>/<slug>` endpoint and read `skillId ?? skill_id`;
 * this hook is that shared step.
 *
 * Returns `{ skillId: null, resolveError: null }` while loading, then exactly
 * one of the two. The 404 message names the seed script because an unseeded
 * environment is the usual cause. Callers keep their own loading/error JSX
 * (each island has its own copy + test ids).
 *
 * Uses the TEACHER auth token (`fetchWithTeacherAuth`) — these are all
 * teacher-only surfaces.
 */
export function useSkillSlugResolver(
  skillName: string,
  platformOwnerId: string = PLATFORM_OWNER_ID,
): SkillSlugResolution {
  const [skillId, setSkillId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSkillId(null);
    setResolveError(null);
    fetchWithTeacherAuth(
      `/api/proxy/api/skills/by-slug/${encodeURIComponent(platformOwnerId)}/${encodeURIComponent(skillName)}`,
    )
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? `The "${skillName}" skill isn't registered on this environment yet — run scripts/seed-platform-skills.sh.`
              : `failed to resolve skill (${res.status})`,
          );
        }
        const body = (await res.json()) as { skillId?: string; skill_id?: string };
        const id = body.skillId ?? body.skill_id;
        if (!id) throw new Error("skill resolution returned no id");
        setSkillId(id);
      })
      .catch((e) => {
        if (!cancelled) setResolveError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [skillName, platformOwnerId]);

  return { skillId, resolveError };
}
