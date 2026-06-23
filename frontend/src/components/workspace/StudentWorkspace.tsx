"use client";

import type { ComponentProps } from "react";

import { DocumentsPanel, type ActivityMaterial } from "./DocumentsPanel";
import { GenericArtefactFrame, type ActivityArtefact } from "./GenericArtefactFrame";
import { WorkspaceElements } from "./elementRenderers";
import type { CalculatorElementDef } from "./WorkbenchCalculator";
import type { ChartElementDef } from "./WorkbenchChart";
import type { ChecklistItem } from "./ProgressChecklist";
import type { NoteElementDef } from "./WorkbenchNote";
import type { TableElementDef } from "./WorkbenchTable";

interface StudentWorkspaceProps {
  skillId: string;
  /** Active chat session; null in the builder preview (sandboxed, no tutor). */
  sessionId?: string | null;
  /** Sandbox origin for the sim iframe; empty disables the sim surface. */
  sandboxOrigin: string;
  /** The attached sim artefact (1.1.41), or null for a chat-only activity. */
  artefact?: ActivityArtefact | null;
  checklist: ChecklistItem[];
  table: TableElementDef[];
  chart: ChartElementDef[];
  calculator: CalculatorElementDef[];
  note: NoteElementDef[];
  materials: ActivityMaterial[];
  images?: ComponentProps<typeof DocumentsPanel>["images"];
  /** DocumentsPanel scopes content fetches by activity; defaults to skillId. */
  activityId?: string;
}

/**
 * StudentWorkspace — the canonical workspace a student sees for a
 * builder-authored (generic-artefact) activity: the attached simulation stacked
 * above the teacher-authored element tools, with the documents panel below.
 *
 * ONE source for that composition, rendered by BOTH the student chat page and
 * the teacher's activity-builder live preview — so the preview can never drift
 * behind the real student view, and a new workspace element added here appears
 * in both at once. (The per-skill legacy sim frames — KineBot / LED-Planck /
 * Boldkast-as-skill — are NOT this; they predate the generic-artefact path.)
 *
 * Provider-agnostic: the caller supplies the HumanToolEvents context (the chat
 * page and the preview each have their own), so this stays a pure surface.
 */
export function StudentWorkspace({
  skillId,
  sessionId = null,
  sandboxOrigin,
  artefact,
  checklist,
  table,
  chart,
  calculator,
  note,
  materials,
  images = [],
  activityId,
}: StudentWorkspaceProps) {
  return (
    <>
      {artefact && sandboxOrigin ? (
        <GenericArtefactFrame sandboxOrigin={sandboxOrigin} artefact={artefact} sessionId={sessionId} />
      ) : null}
      <WorkspaceElements
        skillId={skillId}
        sessionId={sessionId}
        checklist={checklist}
        table={table}
        chart={chart}
        calculator={calculator}
        note={note}
      />
      <DocumentsPanel materials={materials} images={images} activityId={activityId ?? skillId} />
    </>
  );
}
