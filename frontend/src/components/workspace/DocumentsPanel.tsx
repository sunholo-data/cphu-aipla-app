"use client";

import { useEffect, useState } from "react";
import { EyeOff, FileText, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";

import { ZoomableImage } from "@/components/chat/media/ZoomableImage";
import {
  type DocContent,
  CurriculumApiError,
  fetchCurriculumContent,
} from "@/lib/curriculumApi";
import { fetchActivityImageObjectUrl } from "@/lib/activityImageApi";
import { reportDocumentEvent } from "@/lib/documentApi";
import { MarkdownBody } from "./MarkdownBody";

/** One document the activity is grounded in, as surfaced by
 *  GET /api/activity-configs/active/{id} (1.1.33 M2b). NAMES are shown for
 *  every material (so "what is this grounded in?" is debuggable); the
 *  `studentVisible` flag governs whether the student can open the content.
 *  1.1.44: `kind="image"` materials carry `materialId`/`alt` instead of `docId`
 *  and render as an image (the tutor sees it too). */
export interface ActivityMaterial {
  kind?: "curriculum" | "image";
  docId: string;
  origin: string;
  studentVisible: boolean;
  materialId?: string;
  mimeType?: string;
  alt?: string;
}

/** Display label for a material (image → alt; curriculum → origin/docId). */
function materialLabel(m: ActivityMaterial): string {
  if (m.kind === "image") return m.alt || "Image";
  return m.origin || m.docId;
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
  /** Whose token reads the content. `"student"` (default) uses the group token
   *  + the activity-scoped student ACL — correct in the chat. `"teacher"` uses
   *  the Firebase token — correct in the builder preview, where there is no real
   *  activity to ACL the (preview) id against, so the student path 403s. */
  viewerRole?: "student" | "teacher";
  /** Active chat session — used to report document interactions for research
   *  (1.1.45 M5). Null in the builder preview (no session → events are no-ops). */
  sessionId?: string | null;
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
export function DocumentsPanel({
  materials,
  images,
  activityId,
  viewerRole = "student",
  sessionId = null,
}: DocumentsPanelProps) {
  // Hooks must run before any early return.
  const [openDoc, setOpenDoc] = useState<{ docId: string; title: string } | null>(null);
  const [view, setView] = useState<ViewState | null>(null);

  async function openContent(m: ActivityMaterial) {
    const title = m.origin || m.docId;
    setOpenDoc({ docId: m.docId, title });
    setView({ kind: "loading" });
    // Research telemetry (1.1.45 M5) — observational; not a tutor-context write.
    reportDocumentEvent(sessionId, { kind: "document.open", docId: m.docId });
    try {
      const content = await fetchCurriculumContent(m.docId, activityId, { as: viewerRole });
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
            {shared.map((m) => {
              // 1.1.44 — image material: render the picture (the tutor sees it too).
              if (m.kind === "image" && m.materialId && activityId) {
                return (
                  <li key={`img:${m.materialId}`}>
                    <ActivityImageThumb
                      activityId={activityId}
                      materialId={m.materialId}
                      alt={materialLabel(m)}
                      role={viewerRole}
                      onFullscreen={() =>
                        reportDocumentEvent(sessionId, {
                          kind: "image.fullscreen",
                          materialId: m.materialId,
                        })
                      }
                    />
                  </li>
                );
              }
              const selected = openDoc?.docId === m.docId;
              return (
                <li key={m.docId}>
                  <button
                    type="button"
                    onClick={() => openContent(m)}
                    aria-pressed={selected}
                    className={`flex w-full items-center gap-1.5 rounded border px-2 py-1.5 text-left text-xs hover:border-primary/50 hover:bg-muted ${
                      selected ? "border-primary/60 bg-muted" : "border-border bg-background"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate font-medium">{materialLabel(m)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {hidden.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {/* Not-shared materials are CITED BY NAME (transparency) but their
              content isn't openable — the teacher's per-material visibility
              toggle gates the contents, not the name. */}
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Also used by the tutor — name shown, contents not shared
          </p>
          <ul className="flex flex-col gap-1">
            {hidden.map((m) => (
              <li
                key={m.kind === "image" ? `img:${m.materialId}` : m.docId}
                className="flex items-center gap-1.5 rounded border border-dashed border-border bg-background px-2 py-1.5 text-xs text-muted-foreground"
              >
                {m.kind === "image" ? (
                  <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className="truncate">{materialLabel(m)}</span>
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

      {/* M3 — content viewer, INLINE in the workbench (not a modal) so the doc
          stays open alongside chat — the tutor refers to it while the student
          reads. This is the `workspace` surface (ADR-015); chat lives elsewhere. */}
      {openDoc !== null ? (
        <div
          className="flex min-h-0 flex-col rounded-lg border border-border bg-muted/30"
          aria-label={`Document: ${openDoc.title}`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{openDoc.title}</span>
            </h3>
            <button
              type="button"
              aria-label="Close document"
              onClick={() => {
                setOpenDoc(null);
                setView(null);
              }}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="max-h-[55vh] min-h-0 overflow-auto px-3 py-2 text-sm">
            {view?.kind === "loading" ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading…
              </p>
            ) : view?.kind === "error" ? (
              <p className="text-destructive">{view.message}</p>
            ) : view?.kind === "ready" && !view.content.available ? (
              <p className="text-muted-foreground">
                The content of this document isn&apos;t available to read here yet.
              </p>
            ) : view?.kind === "ready" && !view.content.text.trim() ? (
              <p className="text-destructive">Nothing was extracted from this document.</p>
            ) : view?.kind === "ready" ? (
              <>
                <MarkdownBody text={view.content.text} />
                {view.content.text.length < view.content.chars ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing the first {view.content.text.length.toLocaleString()} of{" "}
                    {view.content.chars.toLocaleString()} characters.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * A teacher-attached image the student is allowed to see (1.1.44). The bytes are
 * auth-gated, so we fetch them with the right token into an object URL (a plain
 * `<img src>` can't carry the bearer) and revoke it on unmount. Click to zoom.
 */
function ActivityImageThumb({
  activityId,
  materialId,
  alt,
  role,
  onFullscreen,
}: {
  activityId: string;
  materialId: string;
  alt: string;
  role: "student" | "teacher";
  onFullscreen?: () => void;
}) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error" }
  >({ kind: "loading" });

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchActivityImageObjectUrl(activityId, materialId, role)
      .then((url) => {
        objectUrl = url;
        if (cancelled) URL.revokeObjectURL(url);
        else setState({ kind: "ready", url });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activityId, materialId, role]);

  return (
    <div className="flex flex-col gap-1">
      {state.kind === "loading" ? (
        <div className="flex h-24 w-full items-center justify-center rounded border border-border bg-muted/30 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        </div>
      ) : state.kind === "error" ? (
        <div className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground">
          <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{alt} — couldn&apos;t load</span>
        </div>
      ) : (
        <ZoomableImage
          src={state.url}
          alt={alt}
          triggerClassName="max-h-48 w-full rounded-md border border-border object-contain"
          onOpen={onFullscreen}
        />
      )}
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <ImageIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{alt}</span>
      </span>
    </div>
  );
}
