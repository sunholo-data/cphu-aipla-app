"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";

import { type TutorCatalogue, type TutorPayload, createTutorVariant } from "@/lib/teacherApi";
import { useT } from "@/i18n";

/**
 * ⚠️ **CURRENTLY MOUNTED NOWHERE** (2026-09-11). This component is complete and
 * tested, and nothing renders it.
 *
 * It used to hang off `TutorPicker`, inside a `<details>`, at the bottom of a
 * CLASS settings page — which is where you choose a tutor, not where you author
 * a research instrument. M asked for it to be dropped from there, and it was.
 * The API behind it (`POST /api/research/tutors/variant`) is untouched and there
 * are zero variants on any environment, so nothing was stranded.
 *
 * It is kept rather than deleted because the variant mechanism is the answer to
 * a real problem: with a strict 1-1 tutor→framework mapping, a measured
 * difference between arms mixes pedagogy with face, voice, gender, age and tone.
 * Variants of ONE persona are what separate them. When that matters, this wants
 * a home on the Approaches surface — beside the frameworks and the custom
 * approaches, which is where tutor authoring now lives.
 *
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
  const t = useT("TutorVariantDialog");
  const [displayName, setDisplayName] = useState(() => t("defaultName", { name: parent.displayName }));
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
      setError(conflict ? t("conflict") : t("failed"));
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
        {t("heading", { name: parent.displayName })}
      </h4>
      <p className="text-xs text-muted-foreground">
        {t("explainer", { name: parent.displayName })}
      </p>

      <div>
        <label htmlFor="variant-name" className="mb-1 block text-xs font-medium">
          {t("name")}
        </label>
        <input
          id="variant-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded border bg-background px-2 py-1.5 text-sm"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t.rich("identifier", { id: id || "—", code: (chunks) => <code>{chunks}</code> })}
        </p>
      </div>

      <div>
        <label htmlFor="variant-framework" className="mb-1 block text-xs font-medium">
          {t("approach")}
        </label>
        <select
          id="variant-framework"
          value={frameworkId}
          onChange={(e) => setFrameworkId(e.target.value)}
          className="w-full rounded border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">{t("approachNone")}</option>
          {selectable.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {selectable.length < frameworks.length ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("placeholders", { n: frameworks.length - selectable.length })}
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
          {busy ? t("creating") : t("create")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
