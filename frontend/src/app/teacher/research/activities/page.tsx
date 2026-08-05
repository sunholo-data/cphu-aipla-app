"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, ShieldAlert } from "lucide-react";

import { type ActivityPayload, listActivities } from "@/lib/teacherApi";
import { CompositionRow, VisibilityBadge } from "@/components/teacher/activityDisplay";
import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

type Status = "loading" | "ok" | "forbidden" | "error";

/**
 * Research view (1.1.5) — a researcher-only, read-only scan of EVERY teacher's
 * activities, in every state, with the owner shown. This is the cross-teacher
 * observation surface, deliberately separate from the teacher's own working
 * library (`/teacher/activities`): "what I see as a researcher" is a distinct
 * place, not a toggle hidden inside the teacher library.
 *
 * Access is enforced by the backend — `?scope=all` is researcher-only and 403s
 * otherwise — so a non-researcher who reaches this URL gets an access-required
 * state, never another teacher's data.
 */
export default function ResearchActivitiesPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [activities, setActivities] = useState<ActivityPayload[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    listActivities("all", { limit: 200 })
      .then((page) => {
        if (cancelled) return;
        setActivities(page.activities);
        setStatus("ok");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // The backend 403s a non-researcher; surface that as access-required
        // rather than a generic failure (readJson encodes the status in the msg).
        const forbidden = err instanceof Error && err.message.includes(" 403");
        setStatus(forbidden ? "forbidden" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const count = activities.length;

  return (
    <TeacherPage
      title="Research"
      subtitle={status === "ok" ? `${count} ${count === 1 ? "activity" : "activities"} · all teachers` : undefined}
    >
      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading activities&hellip;</p>
      ) : status === "forbidden" ? (
        <EmptyState
          icon={ShieldAlert}
          title="Researcher access required"
          description="This cross-teacher research view is available to accounts with the researcher role. Ask an administrator if you need access."
        />
      ) : status === "error" ? (
        <EmptyState
          icon={ClipboardList}
          title="Couldn’t load activities"
          description="Something went wrong fetching the research view. Try again in a moment."
        />
      ) : activities.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No activities yet"
          description="No teacher has created an activity yet."
        />
      ) : (
        <>
          <p className="mb-3 flex items-center gap-1.5 rounded border border-dashed border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Research view — read-only · every teacher · all states (Draft / Private / Shared). Observation only; nothing
            here is editable.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {activities.map((a) => (
              <li key={a.activityId}>
                <ResearchCard activity={a} />
              </li>
            ))}
          </ul>
        </>
      )}
    </TeacherPage>
  );
}

/** A read-only activity card for the research scan: composition, the owner, and
 *  the visibility state — no edit/assign/delete affordances. Clicking opens the
 *  full read-only detail (RVIEW-1 M1). */
function ResearchCard({ activity }: { activity: ActivityPayload }) {
  return (
    <Link
      href={`/teacher/research/activities/${encodeURIComponent(activity.activityId)}`}
      className="block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="research-activity-link"
    >
      <TeacherCard className="transition-colors hover:border-foreground/30 hover:bg-muted/40">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {activity.title || activity.teachingGoal?.slice(0, 60) || activity.activityId}
          </h2>
          <VisibilityBadge visibility={activity.visibility} />
        </div>

        <CompositionRow activity={activity} />

        {activity.teachingGoal ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{activity.teachingGoal}</p>
        ) : null}

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{activity.language === "da" ? "Dansk" : "English"}</span>
          <span className="truncate" data-testid="activity-owner" title={activity.ownerUid}>
            Owner: {activity.ownerLabel ?? activity.ownerUid}
          </span>
        </div>
      </TeacherCard>
    </Link>
  );
}
