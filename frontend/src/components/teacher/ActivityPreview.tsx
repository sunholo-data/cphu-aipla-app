"use client";

import { ChevronDown, Eye } from "lucide-react";
import { useState } from "react";

import { WorkspaceElements } from "@/components/workspace/elementRenderers";
import { HumanToolEventsProvider } from "@/hooks/useHumanToolEvents";
import { builderToElementDefs, hasAnyElement, type BuilderElements } from "@/lib/activityPreview";

interface ActivityPreviewProps {
  state: BuilderElements;
}

// A fixed, non-student skill id so the preview's scratch state (table cells in
// sessionStorage, the table→chart event) can't collide with a real session.
const PREVIEW_SKILL_ID = "__activity_preview__";

/**
 * ActivityPreview — live in-builder preview of the workspace elements (1.1.40).
 * Renders the SHIPPED `WorkspaceElements` from the builder's current state, so
 * the teacher sees exactly what a student sees, updating as they author. The
 * elements are interactive (tick the checklist, fill the table → the chart
 * plots, use the calculator) but sandboxed: `sessionId=null` so nothing reaches
 * a tutor or persists to the activity. The `HumanToolEventsProvider` wrapper
 * keeps checklist ticks from warning about a missing chat provider.
 */
export function ActivityPreview({ state }: ActivityPreviewProps) {
  const [open, setOpen] = useState(true);
  const defs = builderToElementDefs(state);

  return (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-slate-700"
      >
        <span className="flex items-center gap-1.5">
          <Eye className="h-4 w-4 text-slate-500" /> Preview — what students see
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="border-t border-slate-200 bg-slate-50">
          {hasAnyElement(defs) ? (
            <HumanToolEventsProvider>
              <WorkspaceElements
                skillId={PREVIEW_SKILL_ID}
                sessionId={null}
                checklist={defs.checklist}
                table={defs.table}
                chart={defs.chart}
                calculator={defs.calculator}
                note={defs.note}
              />
            </HumanToolEventsProvider>
          ) : (
            <p className="px-4 py-6 text-center text-xs text-slate-400">
              Tilføj elementer (tjekliste, datatabel, graf, beregner eller note) for at se en
              forhåndsvisning af elevernes arbejdsområde.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
