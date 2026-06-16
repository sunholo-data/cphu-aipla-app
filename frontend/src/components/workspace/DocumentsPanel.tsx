"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { EyeOff, FileText, Loader2, Paperclip, X } from "lucide-react";

import { ZoomableImage } from "@/components/chat/media/ZoomableImage";
import {
  type DocContent,
  CurriculumApiError,
  fetchCurriculumContent,
} from "@/lib/curriculumApi";

/** One document the activity is grounded in, as surfaced by
 *  GET /api/activity-configs/active/{id} (1.1.33 M2b). NAMES are shown for
 *  every material (so "what is this grounded in?" is debuggable); the
 *  `studentVisible` flag governs whether the student can open the content. */
export interface ActivityMaterial {
  docId: string;
  origin: string;
  studentVisible: boolean;
}

interface UploadedImage {
  mimeType: string;
  data: string;
}

interface DocumentsPanelProps {
  /** The activity's grounding documents (names-always). */
  materials: ActivityMaterial[];
  /** Images the student has uploaded this session (from the chat messages). */
  images: UploadedImage[];
  /** The active activity id (skillId) — needed for the content-read ACL when a
   *  student opens a shared doc. */
  activityId?: string;
}

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; content: DocContent }
  | { kind: "error"; message: string };

/**
 * The Documents surface in the student workbench (1.1.33 M1). Two parts:
 *  - **This activity's documents** — every grounding source by name, with a
 *    shared / not-shared badge. Names always show (debug + transparency); the
 *    teacher's per-material toggle (M2a) controls whether content is openable.
 *  - **Your uploads** — a gallery of the student's own attached photos,
 *    full-size on click (reuses the shared lightbox).
 */
export function DocumentsPanel({ materials, images, activityId }: DocumentsPanelProps) {
  // Hooks must run before any early return.
  const [openDoc, setOpenDoc] = useState<{ docId: string; title: string } | null>(null);
  const [view, setView] = useState<ViewState | null>(null);

  async function openContent(m: ActivityMaterial) {
    const title = m.origin || m.docId;
    setOpenDoc({ docId: m.docId, title });
    setView({ kind: "loading" });
    try {
      const content = await fetchCurriculumContent(m.docId, activityId);
      setView({ kind: "ready", content });
    } catch (e) {
      const msg =
        e instanceof CurriculumApiError && e.status === 403
          ? "You don't have access to this document's content."
          : "Couldn't load this document.";
      setView({ kind: "error", message: msg });
    }
  }

  if (materials.length === 0 && images.length === 0) return null;

  // Shared docs are the student-facing ones (prominent, openable). Not-shared
  // docs are surfaced by NAME only and COLLAPSED by default, so they don't
  // dominate the workbench — they're transparency/debug, not student content.
  const shared = materials.filter((m) => m.studentVisible);
  const hidden = materials.filter((m) => !m.studentVisible);

  return (
    <section className="flex flex-col gap-4 p-4" aria-label="Documents">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <FileText className="h-4 w-4" aria-hidden="true" />
        Documents
      </h2>

      {shared.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            This activity is based on
          </p>
          <ul className="flex flex-col gap-1">
            {shared.map((m) => (
              <li key={m.docId}>
                <button
                  type="button"
                  onClick={() => openContent(m)}
                  className="flex w-full items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 text-left text-xs hover:border-primary/50 hover:bg-muted"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate font-medium">{m.origin || m.docId}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hidden.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="flex cursor-pointer items-center gap-1.5 py-0.5">
            <EyeOff className="h-3 w-3 shrink-0" aria-hidden="true" />
            {hidden.length} more source{hidden.length === 1 ? "" : "s"} the tutor uses (not shared with you)
          </summary>
          <ul className="mt-1 flex flex-col gap-1 pl-4">
            {hidden.map((m) => (
              <li key={m.docId} className="flex items-center gap-1.5">
                <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{m.origin || m.docId}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {images.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
            Your uploads
          </p>
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <ZoomableImage
                key={i}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt="your upload"
                triggerClassName="h-16 w-16 rounded-md border object-cover"
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* M3 — content viewer: read a shared doc's parsed text. */}
      <Dialog.Root
        open={openDoc !== null}
        onOpenChange={(o) => {
          if (!o) {
            setOpenDoc(null);
            setView(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
              <Dialog.Title className="truncate text-sm font-semibold">
                {openDoc?.title}
              </Dialog.Title>
              <Dialog.Close
                aria-label="Close"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-sm">
              {view?.kind === "loading" ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading…
                </p>
              ) : view?.kind === "error" ? (
                <p className="text-destructive">{view.message}</p>
              ) : view?.kind === "ready" && !view.content.available ? (
                <p className="text-muted-foreground">
                  This document was added before content viewing existed — re-upload it to read it
                  here.
                </p>
              ) : view?.kind === "ready" && !view.content.text.trim() ? (
                <p className="text-destructive">
                  Nothing was extracted from this document.
                </p>
              ) : view?.kind === "ready" ? (
                <>
                  <pre className="whitespace-pre-wrap font-sans leading-relaxed text-foreground">
                    {view.content.text}
                  </pre>
                  {view.content.text.length < view.content.chars ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Showing the first {view.content.text.length.toLocaleString()} of{" "}
                      {view.content.chars.toLocaleString()} characters.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
