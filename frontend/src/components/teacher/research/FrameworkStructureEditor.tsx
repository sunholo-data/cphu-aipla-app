"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";

import {
  type FrameworkStructure,
  type TeachingFrameworkPayload,
  previewFrameworkStructure,
} from "@/lib/teacherApi";

/**
 * Edit a teaching framework's THEORY — constructs, observable behaviours,
 * counter-indications, evaluation hints and citations (1.1.91 TUTOR-4).
 *
 * ## Why this exists rather than a bigger textarea
 *
 * The framework layer's whole claim is that a tutor's prompt is *derived from*
 * a theory, so a reader can hold one against the other and check it. Editing the
 * rendered instruction breaks that on arrival: whatever a researcher types
 * becomes the prompt, and its relationship to the constructs — and therefore to
 * the papers — is gone. Editing the structure keeps the derivation intact, which
 * is the difference between a research instrument and a prompt box.
 *
 * It also has to come BEFORE the M2 co-pilot. `draft_tutor_prompt` proposes a
 * prompt generated from constructs; with no structural editor its output could
 * only land as free text, and the theory trace it exists to preserve would break
 * the moment it was accepted.
 *
 * ## The preview is server-rendered, deliberately
 *
 * The generator is deterministic Python. A client-side re-implementation would
 * drift from what the tutor is actually told — the precise failure this layer
 * exists to prevent — so the preview round-trips to `/structure/preview`, which
 * renders without saving. Debounced, because it fires on every keystroke.
 *
 * ## Citations
 *
 * `vouchedBy` is required and non-empty here because it is required and
 * non-empty in the backend model, where an unvouched citation is
 * unconstructable. A researcher's initials, never a model's name. The form
 * refuses to submit rather than letting the server 422 — but the server is the
 * guard, and it stays the guard when the co-pilot is what fills this in.
 */

type Construct = TeachingFrameworkPayload["constructs"][number];
type Behaviour = Construct["behaviours"][number];
type Citation = TeachingFrameworkPayload["provenance"][number];

const PREVIEW_DEBOUNCE_MS = 400;

function structureOf(fw: TeachingFrameworkPayload): FrameworkStructure {
  // Deep-copied: the editor mutates freely and Cancel has to be able to throw
  // the whole draft away without having touched the loaded framework.
  return JSON.parse(JSON.stringify({ summary: fw.summary, constructs: fw.constructs, provenance: fw.provenance }));
}

function defaultStructureOf(fw: TeachingFrameworkPayload): FrameworkStructure {
  return JSON.parse(
    JSON.stringify({
      summary: fw.defaultSummary,
      constructs: fw.defaultConstructs,
      provenance: fw.defaultProvenance,
    }),
  );
}

/** A small labelled textarea — the shape repeated all over this editor. */
function Field({
  id,
  label,
  value,
  onChange,
  rows = 2,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border bg-background px-2 py-1.5 text-sm"
      />
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ListEditor({
  idPrefix,
  label,
  hint,
  items,
  onChange,
  addLabel,
}: {
  idPrefix: string;
  label: string;
  hint?: string;
  items: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium">{label}</p>
      {hint ? <p className="mb-2 text-[11px] text-muted-foreground">{hint}</p> : null}
      <div className="space-y-1.5">
        {items.map((text, i) => (
          <div key={`${idPrefix}-${i}`} className="flex gap-1.5">
            <input
              aria-label={`${label} ${i + 1}`}
              value={text}
              onChange={(e) => onChange(items.map((t, j) => (j === i ? e.target.value : t)))}
              className="w-full rounded border bg-background px-2 py-1 text-sm"
            />
            <button
              type="button"
              aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="shrink-0 rounded border px-2 hover:bg-muted"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="mt-1.5 flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
      >
        <Plus className="h-3 w-3" aria-hidden />
        {addLabel}
      </button>
    </div>
  );
}

export function FrameworkStructureEditor({
  framework,
  onSave,
  onCancel,
  onRevert,
  busy,
  error,
}: {
  framework: TeachingFrameworkPayload;
  onSave: (structure: FrameworkStructure) => void;
  /** Delete the saved override and go back to the published framework.
   *  Undefined when there is nothing to revert. */
  onRevert?: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState<FrameworkStructure>(() => structureOf(framework));
  const [preview, setPreview] = useState(framework.instruction);
  const [previewError, setPreviewError] = useState(false);
  const seq = useRef(0);

  const update = useCallback((patch: Partial<FrameworkStructure>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  const patchConstruct = useCallback((i: number, patch: Partial<Construct>) => {
    setDraft((d) => ({ ...d, constructs: d.constructs.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  }, []);

  // Live preview from the REAL generator, debounced. `seq` drops responses that
  // arrive out of order — without it a slow early request can overwrite the
  // preview for text the researcher has since changed.
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(() => {
      previewFrameworkStructure(framework.id, draft)
        .then((r) => {
          if (mine !== seq.current) return;
          setPreview(r.instruction);
          setPreviewError(false);
        })
        .catch(() => {
          if (mine !== seq.current) return;
          setPreviewError(true);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, framework.id]);

  const unvouched = useMemo(
    () => draft.provenance.some((p) => !p.citation.trim() || !p.vouchedBy.trim()),
    [draft.provenance],
  );
  const noConstructs = draft.constructs.length === 0;

  return (
    <div className="mt-4 space-y-5 border-t pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">Teaching approach</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Edit the constructs themselves — the moves this approach is made of. Fixed code turns
            them into the tutor&rsquo;s instructions, copying each behaviour word for word, so what
            the tutor is told stays checkable line by line against the sources below.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Two different things, and the labels have to say which is which.
              "Reset the form" only refills these fields from the published
              framework — the saved override is untouched until you save.
              "Discard saved edits" deletes it. Conflating them would let a
              researcher believe they had reverted when they had not. */}
          <button
            type="button"
            onClick={() => setDraft(defaultStructureOf(framework))}
            className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs hover:bg-muted"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            Reset the form to published
          </button>
          {onRevert ? (
            <button
              type="button"
              onClick={onRevert}
              className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs hover:bg-muted"
            >
              Discard saved edits
            </button>
          ) : null}
        </div>
      </div>

      <Field
        id={`summary-${framework.id}`}
        label="Summary"
        value={draft.summary}
        onChange={(v) => update({ summary: v })}
        rows={3}
        hint="Shown to teachers choosing this approach, and on the public page."
      />

      {/* ── constructs ── */}
      <div className="space-y-4">
        <p className="text-xs font-medium">What the theory is made of</p>
        {draft.constructs.map((c, i) => (
          <div key={`c-${i}`} className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <input
                aria-label={`Construct ${i + 1} name`}
                value={c.name}
                onChange={(e) => patchConstruct(i, { name: e.target.value })}
                className="w-full rounded border bg-background px-2 py-1 text-sm font-medium"
              />
              <button
                type="button"
                aria-label={`Remove construct ${c.name || i + 1}`}
                onClick={() => update({ constructs: draft.constructs.filter((_, j) => j !== i) })}
                className="shrink-0 rounded border px-2 py-1 hover:bg-muted"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>

            <Field
              id={`c-summary-${framework.id}-${i}`}
              label="What it is"
              value={c.summary ?? ""}
              onChange={(v) => patchConstruct(i, { summary: v })}
            />

            <ListEditor
              idPrefix={`beh-${i}`}
              label="Behaviours"
              hint="Observable and promptable — “offer a choice of route”, not “support autonomy”."
              items={c.behaviours.map((b) => b.text)}
              addLabel="Add behaviour"
              onChange={(next) =>
                patchConstruct(i, {
                  // Preserve each behaviour's `dimension` across an edit: it is
                  // the epistemic/conceptual tag the theory carries, and
                  // rebuilding from text alone would silently drop it.
                  behaviours: next.map(
                    (text, k): Behaviour => ({ text, dimension: c.behaviours[k]?.dimension ?? null }),
                  ),
                })
              }
            />

            <ListEditor
              idPrefix={`avoid-${i}`}
              label="Avoid"
              hint="The moves this framework is defined against — usually an LLM tutor's defaults."
              items={c.avoid}
              addLabel="Add something to avoid"
              onChange={(next) => patchConstruct(i, { avoid: next })}
            />

            <Field
              id={`c-eval-${framework.id}-${i}`}
              label="How you would tell whether it worked"
              value={c.evaluationHint ?? ""}
              onChange={(v) => patchConstruct(i, { evaluationHint: v })}
              hint="Read by the scoring rubrics — say what to look for in a transcript."
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            update({
              constructs: [...draft.constructs, { name: "", summary: "", behaviours: [], avoid: [] }],
            })
          }
          className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
        >
          <Plus className="h-3 w-3" aria-hidden />
          Add construct
        </button>
      </div>

      {/* ── references ── */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium">References</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Every source needs the initials of the person who checked it. Never a model&apos;s.
          </p>
        </div>
        {draft.provenance.map((p, i) => (
          <div key={`p-${i}`} className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              <div className="w-full">
                <Field
                  id={`cite-${framework.id}-${i}`}
                  label="Citation"
                  value={p.citation}
                  onChange={(v) =>
                    update({
                      provenance: draft.provenance.map((q, j): Citation =>
                        j === i ? { ...q, citation: v } : q,
                      ),
                    })
                  }
                />
              </div>
              <button
                type="button"
                aria-label={`Remove reference ${i + 1}`}
                onClick={() => update({ provenance: draft.provenance.filter((_, j) => j !== i) })}
                className="mt-5 shrink-0 rounded border px-2 py-1 hover:bg-muted"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div>
              <label htmlFor={`vouch-${framework.id}-${i}`} className="mb-1 block text-xs font-medium">
                Checked by
              </label>
              <input
                id={`vouch-${framework.id}-${i}`}
                value={p.vouchedBy}
                placeholder="Initials, e.g. AR"
                onChange={(e) =>
                  update({
                    provenance: draft.provenance.map((q, j): Citation =>
                      j === i ? { ...q, vouchedBy: e.target.value } : q,
                    ),
                  })
                }
                className="w-40 rounded border bg-background px-2 py-1 text-sm"
              />
            </div>
            <Field
              id={`note-${framework.id}-${i}`}
              label="Note"
              value={p.note ?? ""}
              onChange={(v) =>
                update({
                  provenance: draft.provenance.map((q, j): Citation => (j === i ? { ...q, note: v } : q)),
                })
              }
              hint="Which part you took, and anything a later reader would need to know."
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => update({ provenance: [...draft.provenance, { citation: "", vouchedBy: "", note: "" }] })}
          className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
        >
          <Plus className="h-3 w-3" aria-hidden />
          Add reference
        </button>
      </div>

      {/* ── live preview ── */}
      <div>
        <p className="mb-1 text-xs font-medium">What the tutor will be told</p>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Assembled from the constructs above by the same code that runs in the lesson — no AI, no
          paraphrasing, and not an approximation. Every line below appears verbatim in one of the
          fields above. Citations are not included: they are review metadata, never shown to the
          tutor or the student.
        </p>
        <pre
          data-testid="structure-preview"
          className="max-h-80 overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-3 font-mono text-xs"
        >
          {preview}
        </pre>
        {previewError ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Could not refresh the preview — it may be behind your latest edit.
          </p>
        ) : null}
      </div>

      {noConstructs ? (
        <p className="text-sm text-destructive">
          A framework needs at least one construct. To go back to the published version, use Reset.
        </p>
      ) : null}
      {unvouched ? (
        <p className="text-sm text-destructive">
          Every reference needs a citation and the initials of whoever checked it.
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || noConstructs || unvouched}
          onClick={() => onSave(draft)}
          className="rounded bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save teaching approach"}
        </button>
        <button type="button" onClick={onCancel} className="rounded border px-3 py-1.5 text-sm hover:bg-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}
