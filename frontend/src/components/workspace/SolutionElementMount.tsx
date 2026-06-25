"use client";

import { useCallback, useState } from "react";

import { ImageStagingRow, ImageUploadButtons } from "@/components/chat/ImageComposer";
import { useImageAttachments, MAX_IMAGES } from "@/hooks/useImageAttachments";
import { useOptionalProactiveSimOptsRef } from "@/contexts/ProactiveSimContext";
import { SolutionWhiteboard } from "./SolutionWhiteboard";

/** Teacher-authored solution element (1.1.45 M4 → image-based 1.1.48, JB-2).
 *  The teacher authors the `prompt`; the student DRAWS their solution (or uploads
 *  a photo of pen-and-paper work). */
export interface SolutionElementDef {
  id: string;
  prompt: string;
}

// The turn the image(s) ride on. The work IS the image (the tutor is multimodal,
// 1.1.7) — no LaTeX. Non-empty (ag_ui_adk drops empty turns); the tutor matches
// the student's language regardless.
const SOLUTION_SUBMIT_TEXT = "Her er min løsning — giv mig feedback på den.";

/**
 * SolutionElementMount (1.1.48, JB-2 "din løsning") — a freehand **whiteboard
 * first** (the natural way to do physics: draw the working, add typed labels),
 * with the option to **upload a photo** of pen-and-paper work instead/as well.
 * Both feed one staged set of images; on submit they ride a native multimodal
 * turn so the tutor SEES the work and gives feedback (the 1.1.45 prompt). This
 * replaced the TipTap LaTeX editor, which was wrong for students.
 */
export function SolutionElementMount({ solution }: { solution: SolutionElementDef[] }) {
  const def = solution[0];
  const photo = useImageAttachments();
  const proactiveRef = useOptionalProactiveSimOptsRef();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const full = photo.count >= MAX_IMAGES;

  const submit = useCallback(() => {
    if (photo.count === 0) return;
    setSubmitting(true);
    try {
      // Send the drawing(s)/photo(s) as a turn → the tutor sees the work.
      proactiveRef?.current?.onProactiveTrigger(SOLUTION_SUBMIT_TEXT, photo.attachments);
      photo.clear();
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }, [photo, proactiveRef]);

  if (!def) return null;

  return (
    <section className="flex min-h-0 flex-col gap-2 p-2" aria-label="Din løsning">
      <p className="text-sm font-medium text-foreground">
        {def.prompt || "Tegn din løsning på tavlen — eller upload et billede af din håndskrevne løsning."}
      </p>

      {/* Whiteboard first — the primary surface. "Tilføj tegning" stages it. */}
      <SolutionWhiteboard onAdd={(file) => void photo.addFiles([file])} />

      {/* Staged drawings + photos. */}
      <ImageStagingRow staged={photo.staged} notice={photo.notice} onRemove={photo.remove} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Eller upload et billede:</span>
          <ImageUploadButtons onFiles={photo.addFiles} disabled={submitting} full={full} />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={photo.count === 0 || submitting}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Send løsning
        </button>
      </div>
      {sent && photo.count === 0 ? (
        <p className="text-xs text-muted-foreground">Løsning sendt — tutoren svarer i chatten.</p>
      ) : null}
    </section>
  );
}
