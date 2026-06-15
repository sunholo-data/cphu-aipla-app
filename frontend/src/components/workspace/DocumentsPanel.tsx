"use client";

import { Eye, EyeOff, FileText, Paperclip } from "lucide-react";

import { ZoomableImage } from "@/components/chat/media/ZoomableImage";

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
}

/**
 * The Documents surface in the student workbench (1.1.33 M1). Two parts:
 *  - **This activity's documents** — every grounding source by name, with a
 *    shared / not-shared badge. Names always show (debug + transparency); the
 *    teacher's per-material toggle (M2a) controls whether content is openable.
 *  - **Your uploads** — a gallery of the student's own attached photos,
 *    full-size on click (reuses the shared lightbox).
 */
export function DocumentsPanel({ materials, images }: DocumentsPanelProps) {
  if (materials.length === 0 && images.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 p-4" aria-label="Documents">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <FileText className="h-4 w-4" aria-hidden="true" />
        Documents
      </h2>

      {materials.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            This activity is based on
          </p>
          <ul className="flex flex-col gap-1">
            {materials.map((m) => (
              <li
                key={m.docId}
                className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5 text-xs"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate font-medium">{m.origin || m.docId}</span>
                </span>
                {m.studentVisible ? (
                  <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    <Eye className="h-3 w-3" aria-hidden="true" />
                    Shared
                  </span>
                ) : (
                  <span
                    className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    title="Used by the tutor but not shared with you"
                  >
                    <EyeOff className="h-3 w-3" aria-hidden="true" />
                    Not shared
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
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
    </section>
  );
}
