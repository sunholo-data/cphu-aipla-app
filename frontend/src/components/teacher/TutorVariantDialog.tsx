"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";

import { type TutorCatalogue, type TutorPayload, createTutorVariant } from "@/lib/teacherApi";

/**
 * Create a variant of an existing tutor (1.1.91 M1 / M5) — researcher-only.
 *
 * A researcher does not edit "Sofie" to teach with ESRU; they create a VARIANT
 * of Sofie that does, and the parent is untouched. That is what makes the
 * comparison askable later — "the framework as designed vs as teachers actually
 * adapted it" needs the delta on record, which is 1.1.91's stated reason for
 * carrying lineage at all.
 *
 * The form states the DELTA and inherits the rest, so the only required inputs
 * are a name and what is changing.
 */
export function TutorVariantDialog({
  parent,
  frameworks,
  onCreated,
  onCancel,
}: {
  parent: TutorPayload;
  frameworks: TutorCatalogue["frameworks"];
  onCreated: (variant: TutorPayload) => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState(`${parent.displayName} — variant`);
  const [frameworkId, setFrameworkId] = useState(parent.frameworkId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Slug derived from the name so a researcher never has to think about ids,
  // but shown, because it is the key 1.1.92 will attribute scores to.
  const id = displayName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await createTutorVariant({
          parentId: parent.id,
          id,
          displayName: displayName.trim(),
          frameworkId: frameworkId || null,
        }),
      );
    } catch (err) {
      const conflict = err instanceof Error && err.message.includes(" 409");
      setError(conflict ? "A tutor with that name already exists — try another." : "Could not create the variant.");
    } finally {
      setBusy(false);
    }
  };

  // Only frameworks with drafted teaching moves can be chosen: a placeholder
  // would produce a tutor that claims an approach and teaches with none.
  const selectable = frameworks.filter((f) => !f.isPlaceholder);

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        <GitBranch className="h-4 w-4" aria-hidden />
        New variant of {parent.displayName}
      </h4>
      <p className="text-xs text-muted-foreground">
        {parent.displayName} is not changed. The variant keeps its picture, voice and tone unless
        you change them here, and records that it came from {parent.displayName}.
      </p>

      <div>
        <label htmlFor="variant-name" className="mb-1 block text-xs font-medium">
          Name
        </label>
        <input
          id="variant-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded border bg-background px-2 py-1.5 text-sm"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Identifier: <code>{id || "—"}</code>
        </p>
      </div>

      <div>
        <label htmlFor="variant-framework" className="mb-1 block text-xs font-medium">
          Teaching approach
        </label>
        <select
          id="variant-framework"
          value={frameworkId}
          onChange={(e) => setFrameworkId(e.target.value)}
          className="w-full rounded border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">None — teaches as it does now</option>
          {selectable.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {selectable.length < frameworks.length ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {frameworks.length - selectable.length} more frameworks are in the library but their
            teaching moves are not written yet.
          </p>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !id || !displayName.trim()}
          onClick={() => void submit()}
          className="rounded bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create variant"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
