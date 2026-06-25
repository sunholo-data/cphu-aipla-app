"use client";

import { useCallback, useState } from "react";

import { ImageStagingRow, ImageUploadButtons } from "@/components/chat/ImageComposer";
import { useImageAttachments, MAX_IMAGES } from "@/hooks/useImageAttachments";
import { useOptionalProactiveSimOptsRef } from "@/contexts/ProactiveSimContext";

/** Teacher-authored solution element (1.1.45 M4 → image-based 1.1.48 M1, JB-2).
 *  The teacher authors the `prompt`; the student submits a PHOTO of their own
 *  (pen-and-paper) work. */
export interface SolutionElementDef {
  id: string;
  prompt: string;
}

// The turn the photo rides on. The work IS the image (the tutor is multimodal,
// 1.1.7) — no LaTeX, no typed prose. Non-empty (ag_ui_adk drops empty turns);
// the tutor matches the student's language regardless.
const SOLUTION_SUBMIT_TEXT = "Her er min løsning — giv mig feedback på den.";

/**
 * SolutionElementMount (1.1.48 M1, JB-2 "din løsning") — the student photographs
 * their pen-and-paper solution and submits it for feedback. Physics is
 * hand-written (equations + diagrams) and the tutor is multimodal, so the
 * solution is an IMAGE, not typed LaTeX (this replaced the TipTap editor).
 *
 * Reuses the proven 1.1.7 multimodal stack wholesale — `useImageAttachments`
 * (on-device person guardrail + downscale) + the composer's upload buttons /
 * staging row. On submit the photo(s) ride a native multimodal turn (via the
 * chat page's `onProactiveTrigger`), so the tutor SEES the work and responds
 * with the 1.1.45 feedback prompt.
 */
export function SolutionElementMount({ solution }: { solution: SolutionElementDef[] }) {
  const def = solution[0];
  const photo = useImageAttachments();
  const proactiveRef = useOptionalProactiveSimOptsRef();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = useCallback(() => {
    if (photo.count === 0) return;
    setSubmitting(true);
    try {
      // Send the photo(s) as a turn → the tutor sees the work + gives feedback.
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
        {def.prompt || "Tag et billede af din håndskrevne løsning, så giver tutoren feedback."}
      </p>
      <ImageStagingRow staged={photo.staged} notice={photo.notice} onRemove={photo.remove} />
      <div className="flex items-center justify-between gap-2">
        <ImageUploadButtons
          onFiles={photo.addFiles}
          disabled={submitting}
          full={photo.count >= MAX_IMAGES}
        />
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
