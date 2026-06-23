"use client";

import { FileText, Plus } from "lucide-react";

export interface NoteEditorValue {
  title: string;
  body: string;
}

interface NoteEditorProps {
  value: NoteEditorValue | null;
  onChange: (value: NoteEditorValue | null) => void;
}

/**
 * NoteEditor — the teacher-builder editor for a note element (1.1.38 M4). The
 * teacher writes a Markdown body (instructions, a formula reference, a
 * definition) shown read-only in the student workspace. Single note for v1.1;
 * `null` means none.
 */
export function NoteEditor({ value, onChange }: NoteEditorProps) {
  if (!value) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Note (optional)</span>
          <button
            type="button"
            onClick={() => onChange({ title: "", body: "" })}
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add note
          </button>
        </div>
        <p className="text-xs text-slate-500">
          A reference card shown in the workspace — instructions, a formula sheet, a definition. Supports
          Markdown.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <FileText className="h-4 w-4 text-slate-500" /> Note
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          Remove note
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Title (optional)</span>
        <input
          type="text"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="e.g. Husk formlerne"
          maxLength={120}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Text (Markdown)</span>
        <textarea
          aria-label="Note text"
          value={value.body}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          placeholder={"e.g. **Fart:** v = s / t\n\nHusk at omregne til SI-enheder."}
          rows={5}
          maxLength={4000}
          className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
        />
      </label>
    </div>
  );
}
