"use client";

import { ChevronDown, Eye, FlaskConical, Maximize2, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { WorkspaceElements } from "@/components/workspace/elementRenderers";
import {
  GenericArtefactFrame,
  type ActivityArtefact,
} from "@/components/workspace/GenericArtefactFrame";
import { HumanToolEventsProvider } from "@/hooks/useHumanToolEvents";
import {
  builderToElementDefs,
  hasAnyElement,
  type ActivityElementDefs,
  type BuilderElements,
} from "@/lib/activityPreview";
import { listArtefacts, type ArtefactSummary } from "@/lib/teacherApi";

interface ActivityPreviewProps {
  state: BuilderElements;
  /** The attached sim artefact id (1.1.41) — rendered above the elements, the
   *  way a student sees the workspace (sim on top, tools below). */
  artefactId?: string | null;
}

// A fixed, non-student skill id so the preview's scratch state (table cells in
// sessionStorage, the table→chart event) can't collide with a real session.
const PREVIEW_SKILL_ID = "__activity_preview__";

// Same origin the chat page derives — NEXT_PUBLIC_MCP_SANDBOX_URL points at
// /sandbox.html; strip the suffix for the bare sandbox origin. Empty when the
// environment has no sandbox service (the preview degrades to a labelled card).
const SANDBOX_ORIGIN = (process.env.NEXT_PUBLIC_MCP_SANDBOX_URL ?? "").replace(
  /\/sandbox\.html$/,
  "",
);

/**
 * ActivityPreview — live in-builder preview of the workspace (1.1.40). Renders
 * the SHIPPED student surfaces from the builder's current state — the attached
 * sim (`GenericArtefactFrame`) stacked above the `WorkspaceElements` — so the
 * teacher sees exactly what a student sees, updating as they author. Everything
 * is interactive but sandboxed: `sessionId=null` so nothing reaches a tutor or
 * persists. A pop-out opens the same preview full-screen so the teacher can
 * actually drive the simulation while reviewing the activity.
 */
export function ActivityPreview({ state, artefactId }: ActivityPreviewProps) {
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
  const hasContent = !!artefactId || showElements;

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
            <PreviewBody artefactId={artefactId} sim={sim} defs={defs} showElements={showElements} />
          )}
        </div>
      )}

      {expanded ? (
        <PreviewModal onClose={() => setExpanded(false)}>
          <PreviewBody artefactId={artefactId} sim={sim} defs={defs} showElements={showElements} />
        </PreviewModal>
      ) : null}
    </div>
  );
}

/** The student workspace itself — the attached sim stacked over the element
 *  tools. Shared by the inline panel and the full-screen pop-out so they render
 *  identically. */
function PreviewBody({
  artefactId,
  sim,
  defs,
  showElements,
}: {
  artefactId?: string | null;
  sim: ArtefactSummary | null;
  defs: ActivityElementDefs;
  showElements: boolean;
}) {
  return (
    <HumanToolEventsProvider>
      {artefactId ? (
        SANDBOX_ORIGIN && sim ? (
          <GenericArtefactFrame
            sandboxOrigin={SANDBOX_ORIGIN}
            artefact={simToArtefact(sim)}
            sessionId={null}
          />
        ) : (
          <div className="flex items-start gap-2 border-b border-slate-200 px-4 py-3 text-xs text-slate-500">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
            <span>
              <span className="font-medium text-slate-700">{sim?.displayName ?? artefactId}</span>{" "}
              simulation attached.
              {SANDBOX_ORIGIN
                ? " Loading the live simulation…"
                : " The live simulation appears here once the sandbox service is configured for this environment."}
            </span>
          </div>
        )
      ) : null}
      {showElements ? (
        <WorkspaceElements
          skillId={PREVIEW_SKILL_ID}
          sessionId={null}
          checklist={defs.checklist}
          table={defs.table}
          chart={defs.chart}
          calculator={defs.calculator}
          note={defs.note}
        />
      ) : null}
    </HumanToolEventsProvider>
  );
}

/** A full-screen overlay holding the preview so the teacher can drive the sim
 *  at real size. Escape / backdrop / the close button all dismiss it; focus
 *  starts on close and body scroll is locked while open. */
function PreviewModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Preview — what students see"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-background shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Eye className="h-4 w-4 text-slate-500" /> Preview — what students see
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">{children}</div>
      </div>
    </div>
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
