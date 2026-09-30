"use client";

import { type ComponentProps, useState } from "react";

import { useT } from "@/i18n";

import { DocumentsPanel, type ActivityMaterial } from "./DocumentsPanel";
import { GenericArtefactFrame, type ActivityArtefact } from "./GenericArtefactFrame";
import { SimFrameHeader } from "./SimFrameHeader";
import { SimLauncher } from "./SimLauncher";
import { WorkbenchTabs } from "./WorkbenchTabs";
import { WorkspaceElements } from "./elementRenderers";
import { useSimFocusMode } from "./workspaceLayout";
import type { CalculatorElementDef } from "./WorkbenchCalculator";
import type { ChartElementDef } from "./WorkbenchChart";
import type { ChecklistItem, ChecklistItemState } from "./ProgressChecklist";
import type { NoteElementDef } from "./WorkbenchNote";
import type { WritingElementDef } from "./WorkbenchWriting";
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
  writing: WritingElementDef[];
  /** Activity title — stamped into a downloaded writing export. */
  activityTitle?: string;
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
  writing,
  activityTitle,
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
  const hasSim = !!(artefact && sandboxOrigin);

  // Launched: the sim takes over the workspace (the element tools + documents
  // are hidden until the student closes it). Element scratch state survives the
  // unmount via sessionStorage, so closing returns the workbench intact.
  if (hasSim && simOpen && artefact) {
    return (
      <OpenSim
        artefact={artefact}
        sandboxOrigin={sandboxOrigin}
        sessionId={sessionId}
        activityId={activityId}
        focusKey={activityId ?? skillId}
        onClose={() => setSimOpen(false)}
        onRegisterArtefactFlush={onRegisterArtefactFlush}
      />
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
    writing.length > 0 ||
    solution.length > 0 ||
    document.length > 0 ||
    conceptMap.length > 0;
  const hasDocuments = materials.length > 0 || images.length > 0;
  const docCount = materials.length + images.length;

  // NO skillId fallback for the elements' activityId: the progress endpoints
  // the elements call (table/writing/checklist/concept) are ACTIVITY-store-only
  // — a skill id gets the teacher a 404 and a student orphan rows nobody reads.
  // The elements are all designed to degrade to local state when activityId is
  // undefined (WorkbenchTable's "pre-1.1.88 behaviour", ProgressChecklist's
  // localStorage mode), so undefined is the honest value for a bare-skill mount.
  // The builder preview passes no activityId at all — with the old fallback it
  // was silently firing doomed /activities/{skillId}/table calls on every
  // render. DocumentsPanel below keeps the fallback: the document/curriculum
  // subsystem genuinely tolerates a skill id.
  const elementsSurface = (
    <WorkspaceElements
      skillId={skillId}
      activityId={activityId}
      sessionId={sessionId}
      checklist={checklist}
      table={table}
      chart={chart}
      calculator={calculator}
      note={note}
      writing={writing}
      activityTitle={activityTitle}
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

interface OpenSimProps {
  artefact: ActivityArtefact;
  sandboxOrigin: string;
  sessionId: string | null;
  activityId?: string;
  /** Focus mode is remembered per activity (the skill for a bare-skill mount). */
  focusKey: string;
  onClose: () => void;
  onRegisterArtefactFlush?: (flush: (() => Promise<void>) | null) => void;
}

/** The launched sim: header + frame. Its own component so focus mode (1.1.140
 *  M1) lives exactly as long as the sim is open — it is applied on open and the
 *  chat is handed back on close. */
function OpenSim({
  artefact,
  sandboxOrigin,
  sessionId,
  activityId,
  focusKey,
  onClose,
  onRegisterArtefactFlush,
}: OpenSimProps) {
  const t = useT("StudentWorkspace");
  // The toggle is named for the chat it shows or hides, and pressed while the
  // chat is shown. Reuses the "Show chat" string the reveal tab already has.
  const focus = useSimFocusMode(focusKey);
  // Callback ref → state so SimFrameHeader gets the real wrapper element once it
  // mounts (a plain ref is still null on first render).
  const [simWrap, setSimWrap] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setSimWrap}
      data-sim-focused={focus.focused ? "" : undefined}
      className="flex min-h-0 flex-col bg-background"
    >
      <SimFrameHeader
        title={artefact.displayName}
        closeAriaLabel={t("closeSimLabel", { name: artefact.displayName })}
        closeLabel={t("close")}
        fullscreenAriaLabel={t("fullscreen")}
        onClose={onClose}
        fullscreenTarget={simWrap}
        focus={
          focus.available
            ? {
                chatShown: !focus.focused,
                onToggle: focus.toggle,
                label: focus.focused ? t("exitFocusMode") : t("focusMode"),
              }
            : undefined
        }
      />
      <GenericArtefactFrame
        sandboxOrigin={sandboxOrigin}
        artefact={artefact}
        sessionId={sessionId}
        activityId={activityId}
        onRegisterFlush={onRegisterArtefactFlush}
      />
    </div>
  );
}
