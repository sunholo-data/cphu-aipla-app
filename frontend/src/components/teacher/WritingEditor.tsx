"use client";

import { PenLine, Plus, Trash2 } from "lucide-react";

export interface WritingEditorRow {
  /** Client key for React; not persisted. */
  key: number;
  /** Stable element id. PRESERVED across loads — student text is keyed by it,
   *  so re-minting positionally would orphan a group's work (the 1.1.71
   *  lesson, applied before it can bite here). Empty for a not-yet-saved row;
   *  minted at save time from the key. */
  id: string;
  title: string;
  prompt: string;
  minWords: number;
}

interface WritingEditorProps {
  value: WritingEditorRow[];
  onChange: (value: WritingEditorRow[]) => void;
  /** Mints a unique client key (shared with the rest of the builder). */
  nextKey: () => number;
  /** Registry cap; the Add button disables at it. */
  maxItems?: number;
}

/**
 * WritingEditor — the teacher-builder editor for writing elements (1.1.73).
 *
 * The teacher authors a title, the task, and an optional word target. The
 * student writes the text; it is never stored on the activity config.
 *
 * A LIST, not a single slot: a lab report wanting both a "method" and a
 * "conclusion" box is the obvious first request, and 1.1.71 records what
 * retrofitting that costs once ids have student data hanging off them.
 */
export function WritingEditor({ value, onChange, nextKey, maxItems = 3 }: WritingEditorProps) {
  const add = () =>
    onChange([...value, { key: nextKey(), id: "", title: "", prompt: "", minWords: 0 }]);
  const update = (key: number, patch: Partial<WritingEditorRow>) =>
    onChange(value.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: number) => onChange(value.filter((row) => row.key !== key));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Skrivefelt (optional)</span>
        <button
          type="button"
          onClick={add}
          disabled={value.length >= maxItems}
          className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add writing field
        </button>
      </div>
      <p className="text-xs text-slate-500">
        A box the student writes in — a conclusion, a reflection, a report section. They can download it as a
        file, and the tutor can read and comment on it. For hand-written physics working, use &ldquo;Din
        løsning&rdquo; instead.
      </p>

      {value.map((row) => (
        <div key={row.key} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <PenLine className="h-4 w-4 text-slate-500" /> Skrivefelt
            </span>
            <button
              type="button"
              onClick={() => remove(row.key)}
              aria-label={`Remove writing field ${row.title || ""}`.trim()}
              className="rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Title</span>
            <input
              type="text"
              value={row.title}
              onChange={(e) => update(row.key, { title: e.target.value })}
              placeholder="e.g. Konklusion"
              maxLength={120}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Task shown to the student</span>
            <textarea
              aria-label={`Writing task ${row.title || ""}`.trim()}
              value={row.prompt}
              onChange={(e) => update(row.key, { prompt: e.target.value })}
              placeholder="e.g. Skriv jeres konklusion — hvad viser målingerne, og hvorfor?"
              rows={3}
              maxLength={2000}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Word target (0 = none)</span>
            <input
              type="number"
              min={0}
              max={2000}
              value={row.minWords}
              onChange={(e) => update(row.key, { minWords: Math.max(0, Number(e.target.value) || 0) })}
              className="w-28 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
            <span className="text-[11px] text-slate-500">
              Shown to the student as a goal. It never blocks them from saving.
            </span>
          </label>
        </div>
      ))}
    </div>
  );
}
