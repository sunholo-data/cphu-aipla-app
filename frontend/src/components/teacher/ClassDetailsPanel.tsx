"use client";

/**
 * 1.1.112 — rename a class (and edit its description).
 *
 * ⚠️ This is a MOUNTING fix, not a feature. `PATCH /api/classes/{id}` has always
 * accepted `{name, description, cohort}`, `patchClass()` has been in
 * `teacherApi.ts` with a passing test, and nothing in any UI called it — so a
 * teacher who mistyped a class name had no way to correct it. Reported from prod
 * 2026-09-14: *"is it possible to change the name of the class? I can not find a
 * way to do that"*.
 *
 * Renaming in place rather than duplicate-and-delete, deliberately:
 *   - a new class mints new group codes, so every join link already handed out
 *     dies — the footgun that cost a teacher ~2h on 2026-08-04;
 *   - chat logs, rubric runs and concept progress are keyed on `class_id`, so a
 *     duplicate splits one class's evidence across two containers, which is the
 *     "looks like evidence but isn't" failure this repo refuses everywhere else.
 *
 * Renaming is safe to do in place: `tagNamespace` is `class:<ownerUid>:<classId>`
 * and carries no name, group codes bind to `classId`, and every consumer of the
 * class name reads it live rather than holding a copy.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { patchClass } from "@/lib/teacherApi";
import { useToast } from "@/hooks/useToast";

// 1.1.108 M4 — user-facing text is data, not code, so a translator can reach it
// without a code change.
const copy = {
  nameLabel: "Class name",
  namePlaceholder: "e.g. Fysik C Energi",
  nameHint: "What you and your students call this class. Changing it keeps every join code working.",
  descriptionLabel: "Description",
  descriptionPlaceholder: "Optional — a note to yourself about this class",
  save: "Save",
  saving: "Saving…",
  saved: "Class updated",
  emptyName: "A class needs a name.",
  failed: "Could not save",
} as const;

const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;

interface Props {
  classId: string;
  initialName: string;
  initialDescription?: string | null;
  onSaved: () => void;
}

export function ClassDetailsPanel({
  classId,
  initialName,
  initialDescription,
  onSaved,
}: Props) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const trimmed = name.trim();
  // The backend enforces min_length=1; refusing here keeps the teacher out of a
  // 422 they cannot read.
  const dirty =
    trimmed !== initialName.trim() || description.trim() !== (initialDescription ?? "").trim();
  const canSave = !saving && dirty && trimmed.length > 0;

  async function save() {
    if (!trimmed) {
      setError(copy.emptyName);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchClass(classId, {
        name: trimmed,
        // "" clears the description; null would leave it untouched server-side,
        // which is not what an emptied box means.
        description: description.trim(),
      });
      showToast(copy.saved, 2000);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="class-name" className="text-sm font-medium">
          {copy.nameLabel}
        </label>
        <input
          id="class-name"
          type="text"
          value={name}
          maxLength={MAX_NAME}
          placeholder={copy.namePlaceholder}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className="w-full max-w-md rounded border border-border bg-background px-3 py-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">{copy.nameHint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="class-description" className="text-sm font-medium">
          {copy.descriptionLabel}
        </label>
        <textarea
          id="class-description"
          value={description}
          rows={2}
          maxLength={MAX_DESCRIPTION}
          placeholder={copy.descriptionPlaceholder}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full max-w-md rounded border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? copy.saving : copy.save}
        </button>
      </div>
      {toast}
    </div>
  );
}
