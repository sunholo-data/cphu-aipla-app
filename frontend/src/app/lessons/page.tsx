"use client";

/**
 * /lessons — student-facing lesson picker (1.B).
 *
 * Replaces v0.1's hardcoded `POST_JOIN_REDIRECT` env var. Fetches
 * `GET /api/skills` (no ownerId filter — returns everything the caller
 * can access via the existing AccessContext.can_access_skill evaluator)
 * and renders one card per skill. The same component serves all three
 * auth shapes:
 *
 *   - Pre-1.A anon-group: backend returns public skills only
 *   - Post-1.A class-bound student: backend returns the class's lessons
 *     (via tag-based access from `class:<teacher_uid>:<class_id>`)
 *   - Firebase teacher: backend returns owned + tagged + public skills
 *
 * Each card links to the existing chat URL via `skillHref()`. Mobile
 * stacks; desktop grids.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, RefreshCw } from "lucide-react";

import { skillHref } from "@/components/navigation/skillHref";
import { useAnonymousGroupAuth } from "@/contexts/AnonymousGroupAuthProvider";
import { fetchWithAuth } from "@/lib/apiClient";
import { isAnonymousGroupAuthMode } from "@/lib/anonymousGroupAuth";
import type { Skill } from "@/types/skill";

// Outer component decides which inner to mount. Calling
// useAnonymousGroupAuth from outside an AnonymousGroupAuthProvider
// throws, and the provider is only mounted in anonymous-group-id
// auth mode (see AuthContext.tsx). Splitting the page lets the same
// route work in all three auth modes (anon / LOCAL_MODE / Firebase).
export default function LessonsPage() {
  // Note: isAnonymousGroupAuthMode reads env baked into the bundle —
  // stable across renders, hook-safe to gate on.
  if (typeof window !== "undefined" && isAnonymousGroupAuthMode()) {
    return <AnonGroupLessonsPage />;
  }
  return <UniversalLessonsPage groupAuthStatus="ready" />;
}

/** One activity in a student's lesson list (ALS-1 M0). The card opens a chat for
 *  (skillId, activityId): the skill runs the agent, the activity selects the
 *  teacher-focus + workbench config. */
interface StudentActivity {
  activityId: string;
  skillId: string;
  title: string;
  artefactId?: string | null;
  workbenchType?: string;
}

function AnonGroupLessonsPage() {
  const router = useRouter();
  const groupAuth = useAnonymousGroupAuth();
  // Live-resolved ACTIVITY list (ALS-1 M0): one card per assigned activity, so a
  // class can show many concept activities (each its own act- id) instead of
  // colliding on one. null = loading; [] = bound but no activities yet.
  const [activities, setActivities] = useState<StudentActivity[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [liveClassName, setLiveClassName] = useState<string | null>(groupAuth.className);

  // Anon-group gate: if not yet joined, bounce back to /group.
  useEffect(() => {
    if (groupAuth.status === "idle") {
      router.replace("/group");
    }
  }, [groupAuth.status, router]);

  // Refresh the activity list from the server on each page visit (so a teacher's
  // add/remove takes effect without a re-join).
  useEffect(() => {
    if (groupAuth.status !== "joined" && groupAuth.status !== "expired") return;
    setLoadError(false);
    fetchWithAuth("/api/proxy/api/auth/group/my-activities")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { activities: StudentActivity[]; class_name: string | null };
        setActivities(data.activities ?? []);
        if (data.class_name) setLiveClassName(data.class_name);
      })
      .catch(() => {
        setActivities([]);
        setLoadError(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupAuth.status]);

  function handleLeave() {
    groupAuth.clearStoredToken();
    router.replace("/group");
  }

  const ready = groupAuth.status === "joined" || groupAuth.status === "expired";
  return (
    <>
      {ready ? (
        <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
            {groupAuth.groupCode ? (
              <span className="text-muted-foreground">
                Gruppe / Group:{" "}
                <code className="font-mono font-medium text-foreground">
                  {groupAuth.groupCode}
                </code>
              </span>
            ) : (
              <span className="text-muted-foreground">Tilmeldt / Joined</span>
            )}
            <div className="flex items-center gap-3">
              <Link
                href="/guides"
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Sådan virker det / How it works
              </Link>
              <button
                type="button"
                onClick={handleLeave}
                className="rounded border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
              >
                Skift kode / Change code
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold sm:text-2xl">Aktiviteter / Activities</h1>
          <p className="text-sm text-muted-foreground">
            Vælg en aktivitet at arbejde med. / Pick an activity to work on.
          </p>
        </header>
        {liveClassName ? (
          <div className="rounded border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Klasse / Class: </span>
            <span className="font-medium">{liveClassName}</span>
          </div>
        ) : null}

        {loadError ? <ErrorBanner message="kunne ikke hentes" onRetry={() => router.refresh()} /> : null}

        {!ready || activities === null ? (
          <p className="text-sm text-muted-foreground">Indlæser… / Loading…</p>
        ) : activities.length === 0 ? (
          <EmptyState className={liveClassName} />
        ) : (
          <section aria-labelledby="lessons-grid-label" className="grid gap-4 sm:grid-cols-2">
            <h2 id="lessons-grid-label" className="sr-only">
              Available activities
            </h2>
            {activities.map((a) => (
              <ActivityLessonCard key={a.activityId} activity={a} />
            ))}
          </section>
        )}
      </main>
    </>
  );
}

/** Card for a student activity. Opens /chat/{skillId}?activity_id={act-…} so the
 *  agent runs the activity's skill with the activity's teacher-focus. */
function ActivityLessonCard({ activity }: { activity: StudentActivity }) {
  const href = `/chat/${encodeURIComponent(activity.skillId)}?activity_id=${encodeURIComponent(
    activity.activityId,
  )}`;
  const title = activity.title || "Aktivitet";
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 overflow-hidden rounded border border-border bg-background shadow-sm transition hover:border-primary"
    >
      <LessonCover avatar="" title={title} />
      <div className="flex flex-col gap-2 p-4 pt-0">
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
    </Link>
  );
}

function UniversalLessonsPage({
  groupAuthStatus,
  allowedSkillIds = null,
  className = null,
}: {
  groupAuthStatus: "ready" | "waiting";
  /** When non-null, only skills whose skillId is in this list are shown.
   *  Null means no filter (Firebase teacher, LOCAL_MODE, or groups with
   *  no lesson assignment yet). */
  allowedSkillIds?: string[] | null;
  /** Human-readable class name (e.g. "Hold 9A"). When set, rendered as
   *  a context banner above the lesson grid so students can confirm
   *  which class they're logged into. */
  className?: string | null;
}) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchWithAuth("/api/proxy/api/skills");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      let list = (await res.json()) as Skill[];
      // Class-lesson filter: when the group token carries a non-empty
      // skill_ids list, restrict to exactly those lessons. Public skills
      // that aren't assigned to this class are hidden even though the
      // backend access check passes them (public = visible to all).
      if (allowedSkillIds !== null) {
        const allowed = new Set(allowedSkillIds);
        list = list.filter((s) => allowed.has(s.skillId));
      }
      // Sort alphabetically by displayName (falls back to name).
      list.sort((a, b) => {
        const an = (a.displayName || a.name).toLowerCase();
        const bn = (b.displayName || b.name).toLowerCase();
        return an.localeCompare(bn);
      });
      setSkills(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedSkillIds?.join(",") ?? ""]);

  useEffect(() => {
    if (groupAuthStatus === "ready") void refresh();
  }, [groupAuthStatus, refresh]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold sm:text-2xl">Aktiviteter / Activities</h1>
        <p className="text-sm text-muted-foreground">
          Vælg en aktivitet at arbejde med. / Pick an activity to work on.
        </p>
      </header>
      {className ? (
        <div className="rounded border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Klasse / Class: </span>
          <span className="font-medium">{className}</span>
        </div>
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}

      {skills === null && !error ? (
        <p className="text-sm text-muted-foreground">Indlæser… / Loading…</p>
      ) : skills && skills.length === 0 ? (
        <EmptyState className={className} />
      ) : skills ? (
        <section
          aria-labelledby="lessons-grid-label"
          className="grid gap-4 sm:grid-cols-2"
        >
          <h2 id="lessons-grid-label" className="sr-only">
            Available activities
          </h2>
          {skills.map((skill) => (
            <LessonCard key={skill.skillId} skill={skill} />
          ))}
        </section>
      ) : null}
    </main>
  );
}

function LessonCard({ skill }: { skill: Skill }) {
  const title = skill.displayName || skill.name;
  const href = skillHref(skill);
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 overflow-hidden rounded border border-border bg-background shadow-sm transition hover:border-primary"
    >
      <LessonCover avatar={skill.avatar} title={title} />
      <div className="flex flex-col gap-2 p-4 pt-0">
        <h3 className="text-base font-semibold">{title}</h3>
        {skill.description ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">
            {skill.description}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/** Card cover slot. Renders skill.avatar if set; otherwise a soft
 *  gradient with a book icon so cards have visual rhythm even before
 *  authors supply images. Aspect 16:9 keeps the grid tidy on both
 *  mobile (stack) and desktop (2-col). */
function LessonCover({ avatar, title }: { avatar: string; title: string }) {
  if (avatar) {
    return (
      <div className="aspect-[16/9] w-full overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatar}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex aspect-[16/9] w-full items-center justify-center bg-gradient-to-br from-muted to-accent"
    >
      <BookOpen className="h-10 w-10 text-muted-foreground" />
      <span className="sr-only">{title}</span>
    </div>
  );
}

function EmptyState({ className = null }: { className?: string | null }) {
  // The class resolved but has no activity assigned yet — say so plainly (vs a
  // blank "nothing here") so the student knows it's a setup step, not a bug.
  const da = className
    ? `Din lærer har ikke tilføjet en aktivitet til ${className} endnu.`
    : "Din lærer har ikke tilføjet en aktivitet endnu.";
  const en = className
    ? `Your teacher hasn't added an activity to ${className} yet.`
    : "Your teacher hasn't added an activity yet.";
  return (
    <div className="flex flex-col items-start gap-2 rounded border border-dashed border-border p-6">
      <p className="text-sm font-medium">{da}</p>
      <p className="text-sm text-muted-foreground">
        <span className="italic">{en}</span> Tjek igen om lidt. / Check back soon.
      </p>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <span>Kunne ikke indlæse aktiviteter: {message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 rounded border border-destructive px-2 py-1 text-xs font-medium hover:bg-destructive/20"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Prøv igen / Retry
      </button>
    </div>
  );
}

