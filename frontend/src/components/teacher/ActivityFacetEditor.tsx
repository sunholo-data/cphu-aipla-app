"use client";

/**
 * File an activity from its library row: own subject / level / tags, plus the
 * read-only facets it inherits from the documents it cites (1.1.61).
 *
 * Writes through `PATCH /api/activities/{id}/facets`, a partial endpoint that
 * can ONLY touch these three fields. It deliberately does not reuse the
 * full-payload `updateActivity`: this row holds a summary, not the elements, so
 * sending a full body from here would wipe them. That is the repo's
 * full-overwrite footgun, and the endpoint's shape is what makes it
 * unexpressible rather than merely avoided.
 */

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

import { InheritedChip } from "@/components/teacher/ui/FacetRow";
import { useT } from "@/i18n";
import { UNLEVELLED } from "@/lib/curriculumApi";
import type { CurriculumFacets } from "@/lib/curriculumApi";
import { patchActivityFacets, type ActivityPayload, type StxLevel } from "@/lib/teacherApi";

const LEVELS: StxLevel[] = ["A", "B", "C"];

export function ActivityFacetEditor({
  activity,
  facets,
  onUpdated,
}: {
  activity: ActivityPayload;
  /** Subject options come from the server so this never keeps its own list. */
  facets: CurriculumFacets | null;
  onUpdated: (updated: ActivityPayload) => void;
}) {
  const t = useT("ActivityFacetEditor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");

  const inheritedTags = activity.inheritedTags ?? [];
  const inheritedSubjects = activity.inheritedSubjects ?? [];
  const inheritedLevels = activity.inheritedLevels ?? [];

  async function apply(patch: Parameters<typeof patchActivityFacets>[1]) {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await patchActivityFacets(activity.activityId, patch));
    } catch {
      // Honest failure — no optimistic state that pretends the write landed.
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const subjectOptions = facets?.subjects.map((s) => s.value) ?? [];
  // The activity's own subject may predate the current vocabulary (it is a SOFT
  // list) — keep it selectable rather than silently dropping it from the picker.
  const subjects = activity.subject && !subjectOptions.includes(activity.subject)
    ? [activity.subject, ...subjectOptions]
    : subjectOptions;

  return (
    <div className="space-y-2 rounded border border-border/60 bg-muted/20 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span className="text-muted-foreground">{t("subject")}</span>
          <select
            aria-label={t("subject")}
            disabled={busy}
            value={activity.subject ?? ""}
            onChange={(e) =>
              void apply(e.target.value ? { subject: e.target.value } : { clearSubject: true })
            }
            className="rounded border border-border bg-background px-1.5 py-0.5"
          >
            <option value="">—</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">{t("level")}</span>
          {LEVELS.map((lv) => {
            const on = activity.level === lv;
            return (
              <button
                key={lv}
                type="button"
                disabled={busy}
                aria-pressed={on}
                onClick={() => void apply(on ? { clearLevel: true } : { level: lv })}
                className={`rounded-full border px-2 py-0.5 transition-colors ${
                  on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {lv}
              </button>
            );
          })}
        </span>
        {busy ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label={t("saving")} /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">{t("tags")}</span>
        {(activity.tags ?? []).map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground"
          >
            {tag}
            <button
              type="button"
              disabled={busy}
              aria-label={t("removeTag", { tag })}
              onClick={() => void apply({ removeTags: [tag] })}
              className="hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const tag = newTag.trim();
            if (!tag) return;
            setNewTag("");
            void apply({ addTags: [tag] });
          }}
          className="inline-flex items-center gap-1"
        >
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder={t("addTagPlaceholder")}
            // Distinct from the submit button's label: two controls with the
            // same accessible name is ambiguous for a screen reader (and was
            // ambiguous for the test that caught it).
            aria-label={t("newTag")}
            disabled={busy}
            className="w-24 rounded border border-border bg-background px-1.5 py-0.5"
          />
          <button type="submit" disabled={busy || !newTag.trim()} aria-label={t("addTag")} className="text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Plus className="h-3 w-3" aria-hidden="true" />
          </button>
        </form>
      </div>

      {inheritedSubjects.length || inheritedLevels.length || inheritedTags.length ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2">
          <span className="text-muted-foreground">{t("fromMaterials")}</span>
          {inheritedSubjects.map((s) => (
            <InheritedChip key={`s-${s}`} label={s} />
          ))}
          {inheritedLevels.map((lv) => (
            <InheritedChip key={`l-${lv}`} label={lv === UNLEVELLED ? t("noLevel") : lv} />
          ))}
          {inheritedTags.map((tag) => (
            <InheritedChip key={`t-${tag}`} label={tag} />
          ))}
        </div>
      ) : null}

      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}
