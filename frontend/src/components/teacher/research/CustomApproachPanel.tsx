"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  type CustomApproach,
  createCustomApproach,
  deleteCustomApproach,
  listCustomApproaches,
  updateCustomApproach,
} from "@/lib/teacherApi";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
const copy = {
  title: "Your own teaching approaches",
  blurb:
    "An approach you write yourself, in your own words. Unlike the seven above it is not drawn from a published paper and does not claim to be — it carries no constructs and no citations. The tutor is told exactly what you write here.",
  none: "No custom approaches yet.",
  create: "New approach",
  nameLabel: "Name",
  namePlaceholder: "e.g. Warm coach",
  summaryLabel: "One-line summary",
  summaryPlaceholder: "Shown to teachers choosing this approach",
  instructionLabel: "What the tutor is told",
  instructionPlaceholder:
    "Write the instructions in full, as if briefing a teaching assistant. e.g. Be encouraging. Ask what the student thinks before explaining anything.",
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  edit: "Edit",
  remove: "Delete",
  confirmRemove: (label: string) => `Delete “${label}”? Any class using it loses its approach.`,
  byYou: "yours",
  byOther: (role: string) => `written by a ${role}`,
  readOnly: "You can read this approach but not change it — it belongs to someone else.",
  failed: "Could not save. Your text is still here — try again.",
  loadFailed: "Could not load custom approaches.",
  // ⚠️ Deletion is not reference-checked server-side; say so rather than imply
  // a safety that is not there.
  deleteWarning:
    "Nothing checks whether a class is still using an approach before it is deleted. A class that loses its approach keeps teaching, without one.",
} as const;

interface Draft {
  id: string | null;
  label: string;
  summary: string;
  instructionText: string;
}

const EMPTY: Draft = { id: null, label: "", summary: "", instructionText: "" };

/**
 * Custom teaching approaches (1.1.110) — the teacher-editable tier.
 *
 * The honest home for free-text authoring. The hand-written-instruction editor
 * that used to sit on the seven published frameworks let anyone overwrite a
 * derived prompt in place while the badge still said "generated" — the
 * capability was fine, the claim attached to it was not. Here the same
 * capability declares what it is.
 *
 * `canEdit` arrives per row from the server and is never re-derived here.
 */
export function CustomApproachPanel() {
  const [rows, setRows] = useState<CustomApproach[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listCustomApproaches()
      .then(setRows)
      .catch(() => setError(copy.loadFailed));
  }, []);

  useEffect(load, [load]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const input = {
        label: draft.label.trim(),
        summary: draft.summary.trim(),
        instructionText: draft.instructionText.trim(),
      };
      if (draft.id) await updateCustomApproach(draft.id, input);
      else await createCustomApproach(input);
      setDraft(null);
      load();
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: CustomApproach) => {
    if (!window.confirm(`${copy.confirmRemove(row.label)}\n\n${copy.deleteWarning}`)) return;
    setBusy(true);
    try {
      await deleteCustomApproach(row.id);
      load();
    } finally {
      setBusy(false);
    }
  };

  const valid = draft && draft.label.trim().length > 0 && draft.instructionText.trim().length > 0;

  return (
    <TeacherCard>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">{copy.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{copy.blurb}</p>
        </div>
        {!draft ? (
          <button
            type="button"
            onClick={() => setDraft({ ...EMPTY })}
            className="flex shrink-0 items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {copy.create}
          </button>
        ) : null}
      </div>

      {draft ? (
        <div className="mt-4 space-y-3 border-t pt-4">
          <label className="block text-sm font-medium" htmlFor="custom-label">
            {copy.nameLabel}
          </label>
          <input
            id="custom-label"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder={copy.namePlaceholder}
            className="w-full rounded border bg-background p-2 text-sm"
          />

          <label className="block text-sm font-medium" htmlFor="custom-summary">
            {copy.summaryLabel}
          </label>
          <input
            id="custom-summary"
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            placeholder={copy.summaryPlaceholder}
            className="w-full rounded border bg-background p-2 text-sm"
          />

          <label className="block text-sm font-medium" htmlFor="custom-instruction">
            {copy.instructionLabel}
          </label>
          <textarea
            id="custom-instruction"
            value={draft.instructionText}
            onChange={(e) => setDraft({ ...draft, instructionText: e.target.value })}
            placeholder={copy.instructionPlaceholder}
            rows={10}
            className="w-full rounded border bg-background p-3 font-mono text-xs"
          />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !valid}
              onClick={() => void save()}
              className="rounded bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {busy ? copy.saving : copy.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {rows === null ? null : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.none}</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="flex items-start justify-between gap-3 rounded border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {row.label}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {row.canEdit && row.authorRole ? copy.byYou : copy.byOther(row.authorRole ?? "colleague")}
                  </span>
                </p>
                {row.summary ? <p className="text-xs text-muted-foreground">{row.summary}</p> : null}
                {!row.canEdit ? <p className="mt-1 text-xs text-muted-foreground">{copy.readOnly}</p> : null}
              </div>
              {row.canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`${copy.edit} ${row.label}`}
                    onClick={() =>
                      setDraft({
                        id: row.id,
                        label: row.label,
                        summary: row.summary,
                        instructionText: row.instructionText,
                      })
                    }
                    className="rounded border p-1.5 hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`${copy.remove} ${row.label}`}
                    onClick={() => void remove(row)}
                    className="rounded border p-1.5 hover:bg-muted"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </TeacherCard>
  );
}
