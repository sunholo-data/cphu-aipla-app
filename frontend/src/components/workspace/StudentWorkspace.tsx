"use client";

import { type ComponentProps, useState } from "react";

import { DocumentsPanel, type ActivityMaterial } from "./DocumentsPanel";
import { GenericArtefactFrame, type ActivityArtefact } from "./GenericArtefactFrame";
import { SimFrameHeader } from "./SimFrameHeader";
import { SimLauncher } from "./SimLauncher";
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
  /** Whose token reads document content: the student (group token, ACL-gated by
   *  the real activity) or the teacher (Firebase token) for the builder preview,
   *  where there is no real activity to ACL against. Default student. */
  documentViewerRole?: "student" | "teacher";
}

/**
 * StudentWorkspace — the canonical workspace a student sees for a
 * builder-authored (generic-artefact) activity: a launch card for the attached
 * simulation (which takes over the workspace when opened, mirroring the legacy
 * per-sim frames), the teacher-authored element tools, and the documents panel.
 *
 * ONE source for that composition, rendered by BOTH the student chat page and
 * the teacher's activity-builder live preview — so the preview can never drift
 * behind the real student view, and a change here (e.g. this launch/takeover
 * behaviour) lands in both at once. (The per-skill legacy sim frames — KineBot /
 * LED-Planck / Boldkast-as-skill — are NOT this; they predate the generic path.)
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
  documentViewerRole = "student",
}: StudentWorkspaceProps) {
  const [simOpen, setSimOpen] = useState(false);
  // Callback ref → state so SimFrameHeader gets the real wrapper element once it
  // mounts (a plain ref is still null on first render).
  const [simWrap, setSimWrap] = useState<HTMLDivElement | null>(null);
  const hasSim = !!(artefact && sandboxOrigin);

  // Launched: the sim takes over the workspace (the element tools + documents
  // are hidden until the student closes it). Element scratch state survives the
  // unmount via sessionStorage, so closing returns the workbench intact.
  if (hasSim && simOpen && artefact) {
    return (
      <div ref={setSimWrap} className="flex min-h-0 flex-col bg-background">
        <SimFrameHeader
          title={artefact.displayName}
          closeAriaLabel={`Luk ${artefact.displayName}`}
          closeLabel="Luk"
          fullscreenAriaLabel="Fuld skærm"
          onClose={() => setSimOpen(false)}
          fullscreenTarget={simWrap}
        />
        <GenericArtefactFrame sandboxOrigin={sandboxOrigin} artefact={artefact} sessionId={sessionId} />
      </div>
    );
  }

  return (
    <>
      {hasSim && artefact ? <SimLauncher artefact={artefact} onOpen={() => setSimOpen(true)} /> : null}
      <WorkspaceElements
        skillId={skillId}
        sessionId={sessionId}
        checklist={checklist}
        table={table}
        chart={chart}
        calculator={calculator}
        note={note}
      />
      <DocumentsPanel
        materials={materials}
        images={images}
        activityId={activityId ?? skillId}
        viewerRole={documentViewerRole}
      />
    </>
  );
}
