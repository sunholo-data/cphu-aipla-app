"use client";

import { PenLine, Plus } from "lucide-react";

export interface SolutionEditorValue {
  /** Teacher's prompt shown above the student's editor ("Write your solution to…"). */
  prompt: string;
}

interface SolutionEditorProps {
  value: SolutionEditorValue | null;
  onChange: (value: SolutionEditorValue | null) => void;
}

/**
 * SolutionEditor — the teacher-builder editor for the solution element (1.1.45
 * M4, JB-2). The teacher authors only the prompt; the *student* writes a
 * rich-text answer in the workspace (TipTap), which is sent to the tutor for
 * Socratic feedback. One solution editor per activity; `null` means none.
 */
export function SolutionEditor({ value, onChange }: SolutionEditorProps) {
  if (!value) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Solution editor (optional)</span>
          <button
            type="button"
            onClick={() => onChange({ prompt: "" })}
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add solution editor
          </button>
        </div>
        <p className="text-xs text-slate-500">
          A rich-text editor where the student writes their own solution; the tutor gives Socratic
          feedback on it (never the full answer). Adds the JB-2 &ldquo;din løsning&rdquo; surface.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <PenLine className="h-4 w-4 text-slate-500" /> Solution editor
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          Remove
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Prompt (optional)</span>
        <textarea
          aria-label="Solution prompt"
          value={value.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="e.g. Skriv din løsning til opgave 3 — vis dine udregninger og forklar dine skridt."
          rows={3}
          maxLength={2000}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}
