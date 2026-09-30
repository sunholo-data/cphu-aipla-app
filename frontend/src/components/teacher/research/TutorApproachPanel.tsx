"use client";

import { useEffect, useState } from "react";
import { GraduationCap, Loader2, Undo2 } from "lucide-react";

import {
  type TutorCatalogue,
  type TutorPayload,
  fetchTutorCatalogue,
  clearTutorFramework,
  setTutorFramework,
} from "@/lib/teacherApi";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { TutorFace } from "@/components/teacher/research/TutorFace";
import { useT } from "@/i18n";

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
  const t = useT("TutorApproachPanel");
  const [catalogue, setCatalogue] = useState<TutorCatalogue | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTutorCatalogue()
      .then((c) => !cancelled && setCatalogue(c))
      .catch(() => !cancelled && setError(t("loadFailed")));
    return () => {
      cancelled = true;
    };
  }, [t]);

  /** Remove the assignment entirely, so the tutor falls back to its own
   *  approach. Distinct from assigning null, which is an override meaning "this
   *  tutor teaches with nothing" — the distinction the old copy blurred. */
  const unassign = async (tutor: TutorPayload) => {
    setSaving(tutor.id);
    setError(null);
    try {
      await clearTutorFramework(tutor.id);
      // Re-read: what the tutor falls back TO is the store's answer, not ours.
      const fresh = await fetchTutorCatalogue();
      setCatalogue(fresh);
    } catch {
      setError(t("undoFailed"));
    } finally {
      setSaving(null);
    }
  };

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
              tutors: c.tutors.map((x) => (x.id === updated.id ? updated : x)),
              skillBoundTutors: (c.skillBoundTutors ?? []).map((x) => (x.id === updated.id ? updated : x)),
            },
      );
    } catch {
      setError(t("changeFailed", { name: tutor.displayName }));
    } finally {
      setSaving(null);
    }
  };

  // A placeholder would give a tutor an approach it cannot teach with. The
  // backend refuses it too — this only keeps it out of the menu.
  const selectable = frameworks.filter((f) => !f.isPlaceholder);

  const row = (tutor: TutorPayload) => (
    <div key={tutor.id} className="flex flex-wrap items-center gap-3 border-t py-2.5 first:border-t-0">
      <TutorFace avatar={tutor.persona?.avatar} name={tutor.displayName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{tutor.displayName}</p>
        {tutor.summary ? <p className="truncate text-xs text-muted-foreground">{tutor.summary}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {saving === tutor.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden /> : null}
        <label htmlFor={`approach-${tutor.id}`} className="sr-only">
          {t("approachFor", { name: tutor.displayName })}
        </label>
        <select
          id={`approach-${tutor.id}`}
          value={tutor.frameworkId ?? ""}
          disabled={saving === tutor.id}
          onChange={(e) => void assign(tutor, e.target.value)}
          className="rounded border bg-background px-2 py-1 text-sm disabled:opacity-50"
        >
          <option value="">{t("noApproach")}</option>
          {selectable.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {tutor.hasAssignment ? (
          <button
            type="button"
            disabled={saving === tutor.id}
            aria-label={t("undoAria", { name: tutor.displayName })}
            title={t("undoTitle")}
            onClick={() => void unassign(tutor)}
            className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            {t("undo")}
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <TeacherCard>
      <h2 className="flex items-center gap-2 text-base font-medium">
        <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("assignmentExplainer")}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {/* ⚠️ This paragraph used to say "set a tutor back to 'No stated
            approach' to undo", which was not true and is the reason
            clearTutorFramework had nothing to render on. The two are different
            acts and only one of them is an undo. */}
        {t.rich("undoExplainer", { b: (chunks) => <strong>{chunks}</strong> })}
      </p>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {catalogue === null ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("loading")}</p>
      ) : (
        <div className="mt-3">
          {catalogue.tutors.map(row)}
          {(catalogue.skillBoundTutors ?? []).length > 0 ? (
            <div className="mt-4 border-t pt-3">
              <p className="text-xs font-medium">{t("activityTutors")}</p>
              <p className="mb-1 text-[11px] text-muted-foreground">
                {t("activityTutorsHelp")}
              </p>
              {(catalogue.skillBoundTutors ?? []).map(row)}
            </div>
          ) : null}
        </div>
      )}
    </TeacherCard>
  );
}
