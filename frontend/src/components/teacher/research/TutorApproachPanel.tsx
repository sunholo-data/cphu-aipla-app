"use client";

import { useEffect, useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";

import {
  type TutorCatalogue,
  type TutorPayload,
  fetchTutorCatalogue,
  setTutorFramework,
} from "@/lib/teacherApi";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";

/**
 * Give each tutor a teaching approach (1.1.91 TUTOR-4) — researcher-only.
 *
 * ## Why this lives on the frameworks page
 *
 * A framework with no tutor attached teaches nobody. Until now the only route
 * from one to the other was creating a *variant* — "Sofie, but with ESRU" — which
 * is right when a researcher wants to compare arms and wrong as the only option,
 * because it means the tutors teachers actually pick have no stated approach at
 * all. This is the other half: say what the default tutors teach with.
 *
 * ## The claim, and who gets to make it
 *
 * Base tutors ship carrying no framework, deliberately: "Sofie teaches with
 * ESRU" is a pedagogical claim, and the git catalogue does not get to make
 * claims nobody signed off. That rule is satisfied here rather than broken — a
 * named researcher makes the claim in the running app and the backend records
 * their uid against it. The YAML stays untouched, and clearing the assignment
 * puts the tutor back exactly as it shipped.
 *
 * ## What it does NOT touch
 *
 * The passthrough guarantee. An activity or class with no tutor selected still
 * composes byte-identically to before any of this existed — an assignment can
 * only change a tutor somebody deliberately chose.
 *
 * Skill-bound tutors are included: they are usable research arms, and the
 * backend stores assignments outside the tutor document precisely so assigning
 * one does not cut it off from future SKILL.md changes.
 */
export function TutorApproachPanel({
  frameworks,
}: {
  frameworks: { id: string; name: string; isPlaceholder: boolean }[];
}) {
  const [catalogue, setCatalogue] = useState<TutorCatalogue | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTutorCatalogue()
      .then((c) => !cancelled && setCatalogue(c))
      .catch(() => !cancelled && setError("Could not load the tutors."));
    return () => {
      cancelled = true;
    };
  }, []);

  const assign = async (tutor: TutorPayload, frameworkId: string) => {
    setSaving(tutor.id);
    setError(null);
    try {
      const { tutor: updated } = await setTutorFramework(tutor.id, frameworkId || null);
      setCatalogue((c) =>
        c === null
          ? c
          : {
              ...c,
              tutors: c.tutors.map((t) => (t.id === updated.id ? updated : t)),
              skillBoundTutors: (c.skillBoundTutors ?? []).map((t) => (t.id === updated.id ? updated : t)),
            },
      );
    } catch {
      setError(`Could not change what ${tutor.displayName} teaches with.`);
    } finally {
      setSaving(null);
    }
  };

  // A placeholder would give a tutor an approach it cannot teach with. The
  // backend refuses it too — this only keeps it out of the menu.
  const selectable = frameworks.filter((f) => !f.isPlaceholder);

  const row = (t: TutorPayload) => (
    <div key={t.id} className="flex flex-wrap items-center gap-3 border-t py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{t.displayName}</p>
        {t.summary ? <p className="truncate text-xs text-muted-foreground">{t.summary}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {saving === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden /> : null}
        <label htmlFor={`approach-${t.id}`} className="sr-only">
          Teaching approach for {t.displayName}
        </label>
        <select
          id={`approach-${t.id}`}
          value={t.frameworkId ?? ""}
          disabled={saving === t.id}
          onChange={(e) => void assign(t, e.target.value)}
          className="rounded border bg-background px-2 py-1 text-sm disabled:opacity-50"
        >
          <option value="">No stated approach</option>
          {selectable.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <TeacherCard>
      <h2 className="flex items-center gap-2 text-base font-medium">
        <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        What each tutor teaches with
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choosing an approach here changes how that tutor teaches in every class using it. The
        published catalogue is not modified — set a tutor back to “No stated approach” to undo.
      </p>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {catalogue === null ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading tutors&hellip;</p>
      ) : (
        <div className="mt-3">
          {catalogue.tutors.map(row)}
          {(catalogue.skillBoundTutors ?? []).length > 0 ? (
            <div className="mt-4 border-t pt-3">
              <p className="text-xs font-medium">Activity tutors</p>
              <p className="mb-1 text-[11px] text-muted-foreground">
                Defined by an activity rather than chosen for a class. They can still be given an
                approach, and doing so does not detach them from their activity.
              </p>
              {(catalogue.skillBoundTutors ?? []).map(row)}
            </div>
          ) : null}
        </div>
      )}
    </TeacherCard>
  );
}
