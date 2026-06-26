"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Eye, Maximize2, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { SimThumbnail } from "@/components/teacher/SimThumbnail";
import { StudentWorkspace } from "@/components/workspace/StudentWorkspace";
import { type ActivityArtefact } from "@/components/workspace/GenericArtefactFrame";
import { HumanToolEventsProvider } from "@/hooks/useHumanToolEvents";
import {
  builderToElementDefs,
  hasAnyElement,
  type ActivityElementDefs,
  type BuilderElements,
} from "@/lib/activityPreview";
import { listArtefacts, type ArtefactSummary, type MaterialRef } from "@/lib/teacherApi";

interface ActivityPreviewProps {
  state: BuilderElements;
  /** The attached sim artefact id (1.1.41) — rendered above the elements, the
   *  way a student sees the workspace (sim on top, tools below). */
  artefactId?: string | null;
  /** Curriculum materials cited for the activity — shown in the documents
   *  panel exactly as a student sees them (studentVisible governs access). */
  materials?: MaterialRef[];
  /** The real activity id — needed so image materials (1.1.44) resolve their
   *  bytes from the right activity slot and curriculum content ACLs correctly.
   *  Falls back to the preview sandbox id when absent (e.g. a brand-new draft). */
  activityId?: string;
}

// A fixed, non-student skill id so the preview's scratch state (table cells in
// sessionStorage, the table→chart event) can't collide with a real session.
const PREVIEW_SKILL_ID = "__activity_preview__";

// Same origin the chat page derives — NEXT_PUBLIC_MCP_SANDBOX_URL points at
// /sandbox.html; strip the suffix for the bare sandbox origin. Empty when the
// environment has no sandbox service (the preview shows a labelled card).
const SANDBOX_ORIGIN = (process.env.NEXT_PUBLIC_MCP_SANDBOX_URL ?? "").replace(
  /\/sandbox\.html$/,
  "",
);

/**
 * ActivityPreview — live in-builder preview of the workspace (1.1.40). Renders
 * the SHARED `StudentWorkspace` from the builder's current state, so the teacher
 * sees exactly what a student sees (sim + element tools + documents), updating
 * as they author. Sandboxed: `sessionId=null` so nothing reaches a tutor or
 * persists. A pop-out opens the same workspace full-screen so the teacher can
 * actually drive the simulation while reviewing the activity.
 */
export function ActivityPreview({
  state,
  artefactId,
  materials = [],
  activityId,
}: ActivityPreviewProps) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [catalogue, setCatalogue] = useState<ArtefactSummary[]>([]);
  const defs = builderToElementDefs(state);

  // Resolve the attached sim id → its catalogue entry (displayName +
  // artefactPath) so the frame can mount it. Only fetched when a sim is set.
  useEffect(() => {
    if (!artefactId) return;
    let alive = true;
    listArtefacts()
      .then((a) => {
        if (alive) setCatalogue(a);
      })
      .catch(() => {
        /* catalogue unreachable — the labelled-card fallback still names it */
      });
    return () => {
      alive = false;
    };
  }, [artefactId]);

  const sim = artefactId ? (catalogue.find((a) => a.id === artefactId) ?? null) : null;
  const showElements = hasAnyElement(defs);
  const hasContent = !!artefactId || showElements || materials.length > 0;

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex w-full items-center gap-1 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1.5 text-sm font-medium text-slate-700"
        >
          <Eye className="h-4 w-4 text-slate-500" /> Preview — what students see
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
        {hasContent ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Open full-size view"
            title="Open full-size view"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {open && (
        <div className="border-t border-slate-200 bg-slate-50">
          {!hasContent ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400">
              Tilføj elementer (tjekliste, datatabel, graf, beregner eller note) eller en simulation for
              at se en forhåndsvisning af elevernes arbejdsområde.
            </p>
          ) : expanded ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Åbnet i fuld skærm.</p>
          ) : (
            <PreviewBody artefactId={artefactId} sim={sim} defs={defs} materials={materials} activityId={activityId} />
          )}
        </div>
      )}

      <PreviewModal open={expanded} onOpenChange={setExpanded}>
        <PreviewBody artefactId={artefactId} sim={sim} defs={defs} materials={materials} activityId={activityId} />
      </PreviewModal>
    </div>
  );
}

/** The student workspace itself, sandboxed for the preview. Renders the SHARED
 *  `StudentWorkspace` (sim + elements + documents) so it can't drift from chat;
 *  the only preview-specific touch is the labelled card when the environment has
 *  no sandbox service to mount the live sim. */
function PreviewBody({
  artefactId,
  sim,
  defs,
  materials,
  activityId,
}: {
  artefactId?: string | null;
  sim: ArtefactSummary | null;
  defs: ActivityElementDefs;
  materials: MaterialRef[];
  activityId?: string;
}) {
  return (
    <HumanToolEventsProvider>
      {artefactId && !SANDBOX_ORIGIN ? (
        <div className="flex items-start gap-2.5 border-b border-slate-200 px-4 py-3 text-xs text-slate-500">
          <SimThumbnail id={sim?.id ?? artefactId} displayName={sim?.displayName ?? artefactId} thumbnail={sim?.thumbnail} />
          <span>
            <span className="font-medium text-slate-700">{sim?.displayName ?? artefactId}</span>{" "}
            simulation attached. The live simulation appears here once the sandbox service is configured
            for this environment.
          </span>
        </div>
      ) : null}
      <StudentWorkspace
        skillId={PREVIEW_SKILL_ID}
        sessionId={null}
        sandboxOrigin={SANDBOX_ORIGIN}
        artefact={sim ? simToArtefact(sim) : null}
        checklist={defs.checklist}
        table={defs.table}
        chart={defs.chart}
        calculator={defs.calculator}
        note={defs.note}
        solution={defs.solution}
        document={defs.document}
        materials={materials.map((m) => ({
          // Preserve the full ref — dropping kind/materialId made image
          // materials (1.1.44) render as (empty-docId) curriculum docs that
          // 404 ("Couldn't load this document") instead of showing the image.
          ...m,
          studentVisible: m.studentVisible ?? false,
        }))}
        activityId={activityId ?? PREVIEW_SKILL_ID}
        documentViewerRole="teacher"
      />
    </HumanToolEventsProvider>
  );
}

/** A full-screen overlay holding the preview so the teacher can drive the sim
 *  at real size. Built on Radix `Dialog`, so it is a proper modal: focus is
 *  trapped inside and restored to the trigger on close, body scroll is locked,
 *  Escape / backdrop / the close button all dismiss it, and `role="dialog"` +
 *  `aria-modal` are set for assistive tech.
 *
 *  Radix portals the content to `document.body`, which also fixes the stacking
 *  bug: the builder's right column is `lg:sticky` (a stacking context) that
 *  would otherwise trap a nested `fixed` overlay below the left column's
 *  `sticky z-10` section nav. At the document root, the overlay's z-50 covers
 *  the page chrome as intended. */
function PreviewModal({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-slate-200 bg-background shadow-xl focus:outline-none"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <Dialog.Title className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <Eye className="h-4 w-4 text-slate-500" /> Preview — what students see
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function simToArtefact(s: ArtefactSummary): ActivityArtefact {
  return {
    id: s.id,
    displayName: s.displayName,
    artefactPath: s.artefactPath,
    topics: s.topics,
    levels: s.levels,
    language: s.language,
    status: s.status,
  };
}
