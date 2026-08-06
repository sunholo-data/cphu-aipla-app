"use client";

import { type ComponentProps, useState } from "react";

import { DocumentsPanel, type ActivityMaterial } from "./DocumentsPanel";
import { GenericArtefactFrame, type ActivityArtefact } from "./GenericArtefactFrame";
import { SimFrameHeader } from "./SimFrameHeader";
import { SimLauncher } from "./SimLauncher";
import { WorkbenchTabs } from "./WorkbenchTabs";
import { WorkspaceElements } from "./elementRenderers";
import type { CalculatorElementDef } from "./WorkbenchCalculator";
import type { ChartElementDef } from "./WorkbenchChart";
import type { ChecklistItem, ChecklistItemState } from "./ProgressChecklist";
import type { NoteElementDef } from "./WorkbenchNote";
import type { TableElementDef } from "./WorkbenchTable";
import type { SolutionElementDef } from "./SolutionElementMount";
import type { DocumentElementDef } from "./DocumentElementMount";
import type { ConceptMapElementDef } from "./ConceptMapView";
import type { ConceptNodeStatus } from "./ConceptMapGraph";

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
  solution: SolutionElementDef[];
  document: DocumentElementDef[];
  conceptMap: ConceptMapElementDef[];
  /** Checkpoint light-up (CONCEPT-1 M3): node id → status; chat-page only. */
  conceptMapNodeStates?: Record<string, ConceptNodeStatus>;
  /** Active uploaded-file → tutor document_ids (threaded to the document element). */
  onDocumentActiveChange?: (docId: string | null) => void;
  materials: ActivityMaterial[];
  images?: ComponentProps<typeof DocumentsPanel>["images"];
  /** DocumentsPanel scopes content fetches by activity; defaults to skillId.
   *  Also keys the per-group checklist tick store (1.1.62 M3). */
  activityId?: string;
  /** 1.1.62 M3 — per-group checklist tick state, refetched at turn end so an
   *  AI tick appears without a reload. Absent in the builder preview. */
  checklistItemStates?: Record<string, ChecklistItemState>;
  /** Whose token reads document content: the student (group token, ACL-gated by
   *  the real activity) or the teacher (Firebase token) for the builder preview,
   *  where there is no real activity to ACL against. Default student. */
  documentViewerRole?: "student" | "teacher";
  /** Registers a "flush the open sim's pending state" callback the chat page
   *  awaits before each outgoing message (null while no sim is open). Omitted in
   *  the builder preview (no tutor turn to flush for). Resolves once the flushed
   *  state has committed (or a short cap elapses). */
  onRegisterArtefactFlush?: (flush: (() => Promise<void>) | null) => void;
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
  solution,
  document,
  conceptMap,
  conceptMapNodeStates,
  checklistItemStates,
  onDocumentActiveChange,
  materials,
  images = [],
  activityId,
  documentViewerRole = "student",
  onRegisterArtefactFlush,
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
        <GenericArtefactFrame
          sandboxOrigin={sandboxOrigin}
          artefact={artefact}
          sessionId={sessionId}
          onRegisterFlush={onRegisterArtefactFlush}
        />
      </div>
    );
  }

  // 1.1.45 M1 — activity-driven surfaces: tabs ONLY when BOTH the element tools
  // and documents have content; a single surface renders directly (no tab layer).
  const hasElements =
    checklist.length > 0 ||
    table.length > 0 ||
    chart.length > 0 ||
    calculator.length > 0 ||
    note.length > 0 ||
    solution.length > 0 ||
    document.length > 0 ||
    conceptMap.length > 0;
  const hasDocuments = materials.length > 0 || images.length > 0;
  const docCount = materials.length + images.length;

  const elementsSurface = (
    <WorkspaceElements
      skillId={skillId}
      activityId={activityId ?? skillId}
      sessionId={sessionId}
      checklist={checklist}
      table={table}
      chart={chart}
      calculator={calculator}
      note={note}
      solution={solution}
      document={document}
      conceptMap={conceptMap}
      conceptMapNodeStates={conceptMapNodeStates}
      checklistItemStates={checklistItemStates}
      onDocumentActiveChange={onDocumentActiveChange}
      documentViewerRole={documentViewerRole}
    />
  );
  const documentsSurface = (
    <DocumentsPanel
      materials={materials}
      images={images}
      activityId={activityId ?? skillId}
      viewerRole={documentViewerRole}
      sessionId={sessionId}
    />
  );

  return (
    <>
      {hasSim && artefact ? <SimLauncher artefact={artefact} onOpen={() => setSimOpen(true)} /> : null}
      {hasElements && hasDocuments ? (
        <WorkbenchTabs work={elementsSurface} documents={documentsSurface} docCount={docCount} />
      ) : (
        <>
          {elementsSurface}
          {documentsSurface}
        </>
      )}
    </>
  );
}
