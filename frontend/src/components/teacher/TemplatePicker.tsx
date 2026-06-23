"use client";

import { Sparkles } from "lucide-react";

import { ACTIVITY_TEMPLATES, type ActivityTemplate } from "@/lib/activityTemplates";

interface TemplatePickerProps {
  onPick: (template: ActivityTemplate) => void;
}

/**
 * TemplatePicker — quick-start templates for the activity builder. Picking one
 * pre-fills the form (prompt + checklist + workbench elements); the teacher then
 * edits everything before publishing. So the builder is never a blank page.
 */
export function TemplatePicker({ onPick }: TemplatePickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <Sparkles className="h-4 w-4 text-indigo-500" /> Start from a template (optional)
      </span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ACTIVITY_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t)}
            className="flex flex-col items-start gap-0.5 rounded-md border border-slate-200 px-3 py-2 text-left hover:border-indigo-300 hover:bg-indigo-50"
          >
            <span className="text-sm font-medium text-slate-800">{t.name}</span>
            <span className="text-xs text-slate-500">{t.summary}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-400">
        Picks a starting point you can fully edit below — prompt, checklist, and workbench elements.
      </p>
    </div>
  );
}
