"use client";

import type { LucideIcon } from "lucide-react";
import {
  Calculator,
  FileUp,
  FlaskConical,
  LineChart,
  ListChecks,
  PenLine,
  Sparkles,
  StickyNote,
  Table2,
} from "lucide-react";

import { ACTIVITY_TEMPLATES, type ActivityTemplate } from "@/lib/activityTemplates";

interface TemplatePickerProps {
  onPick: (template: ActivityTemplate) => void;
}

// The features each template demonstrates, in workspace order. Rendered as
// at-a-glance pills so a teacher can pick a starting point by the tools it
// shows — together the templates cover the whole element palette.
function templateFeatures(t: ActivityTemplate): { label: string; icon: LucideIcon }[] {
  const f: { label: string; icon: LucideIcon }[] = [];
  if (t.artefactId) f.push({ label: "Sim", icon: FlaskConical });
  if (t.checklist.length) f.push({ label: "Checklist", icon: ListChecks });
  if (t.table) f.push({ label: "Table", icon: Table2 });
  if (t.chart) f.push({ label: "Chart", icon: LineChart });
  if (t.calculator) f.push({ label: "Calculator", icon: Calculator });
  if (t.note) f.push({ label: "Note", icon: StickyNote });
  if (t.solution) f.push({ label: "Solution", icon: PenLine });
  if (t.document) f.push({ label: "Document", icon: FileUp });
  return f;
}

/**
 * TemplatePicker — quick-start templates for the activity builder. Picking one
 * pre-fills the form (prompt + checklist + workbench elements); the teacher then
 * edits everything before publishing. So the builder is never a blank page. The
 * feature pills show what each template demonstrates, across the whole palette.
 */
export function TemplatePicker({ onPick }: TemplatePickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <Sparkles className="h-4 w-4 text-indigo-500" /> Start from a template
      </span>
      <p className="text-xs text-slate-500">
        A starting point you can fully edit — prompt, checklist, and workspace tools. Between them the
        templates show every feature you can add.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {ACTIVITY_TEMPLATES.map((t) => {
          const features = templateFeatures(t);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t)}
              className="flex flex-col items-start gap-1.5 rounded-md border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              <span className="text-sm font-medium text-slate-800">{t.name}</span>
              <span className="text-xs text-slate-500">{t.summary}</span>
              <span className="mt-0.5 flex flex-wrap gap-1">
                {features.map((feat) => {
                  const Icon = feat.icon;
                  return (
                    <span
                      key={feat.label}
                      className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      {feat.label}
                    </span>
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
