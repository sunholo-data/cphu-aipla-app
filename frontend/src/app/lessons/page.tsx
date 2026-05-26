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

function AnonGroupLessonsPage() {
  const router = useRouter();
  const groupAuth = useAnonymousGroupAuth();

  // Anon-group gate: if not yet joined, bounce back to /group.
  useEffect(() => {
    if (groupAuth.status === "idle") {
      router.replace("/group");
    }
  }, [groupAuth.status, router]);

  // Fire the fetch once joined (or after expiry — server returns the
  // right thing either way; renders the error banner on 401).
  const ready =
    groupAuth.status === "joined" || groupAuth.status === "expired";
  return <UniversalLessonsPage groupAuthStatus={ready ? "ready" : "waiting"} />;
}

function UniversalLessonsPage({
  groupAuthStatus,
}: {
  groupAuthStatus: "ready" | "waiting";
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
      const list = (await res.json()) as Skill[];
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
  }, []);

  useEffect(() => {
    if (groupAuthStatus === "ready") void refresh();
  }, [groupAuthStatus, refresh]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold sm:text-2xl">Lektioner / Lessons</h1>
        <p className="text-sm text-muted-foreground">
          Vælg en lektion at arbejde med. / Pick a lesson to work on.
        </p>
      </header>

      {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}

      {skills === null && !error ? (
        <p className="text-sm text-muted-foreground">Indlæser… / Loading…</p>
      ) : skills && skills.length === 0 ? (
        <EmptyState />
      ) : skills ? (
        <section
          aria-labelledby="lessons-grid-label"
          className="grid gap-4 sm:grid-cols-2"
        >
          <h2 id="lessons-grid-label" className="sr-only">
            Available lessons
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

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-2 rounded border border-dashed border-border p-6">
      <p className="text-sm font-medium">
        Ingen lektioner tilgængelige endnu.
      </p>
      <p className="text-sm text-muted-foreground">
        Spørg din lærer. /{" "}
        <span className="italic">No lessons available yet. Ask your teacher.</span>
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
      <span>Kunne ikke indlæse lektioner: {message}</span>
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

