"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EyeOff, FileText, Image as ImageIcon, Loader2, Paperclip } from "lucide-react";

import { ZoomableImage } from "@/components/chat/media/ZoomableImage";
import {
  type DocContent,
  CurriculumApiError,
  fetchCurriculumContent,
} from "@/lib/curriculumApi";
import { fetchActivityImageObjectUrl } from "@/lib/activityImageApi";
import { reportDocumentEvent } from "@/lib/documentApi";
import { useT } from "@/i18n";
import { useDocInteractionReporting } from "@/hooks/useDocInteractionReporting";
import { MarkdownBody } from "./MarkdownBody";
import { useDocumentRequest } from "./documentRequest";

/** One document the activity is grounded in, as surfaced by
 *  GET /api/activity-configs/active/{id} (1.1.33 M2b). NAMES are shown for
 *  every material (so "what is this grounded in?" is debuggable); the
 *  `studentVisible` flag governs whether the student can open the content.
 *  1.1.44: `kind="image"` materials carry `materialId`/`alt` instead of `docId`
 *  and render as an image (the tutor sees it too). */
export interface ActivityMaterial {
  kind?: "curriculum" | "image" | "context";
  docId: string;
  origin: string;
  studentVisible: boolean;
  materialId?: string;
  mimeType?: string;
  alt?: string;
}

// 1.1.87 — `kind: "context"` is a curriculum doc attached so the tutor always has
// it. Student-side this panel treats it exactly like a curriculum material: it is
// the same document, and `studentVisible` still decides whether it appears here.

/** Display label for a material (image → alt; curriculum → origin/docId). */
function materialLabel(m: ActivityMaterial, imageFallback: string): string {
  if (m.kind === "image") return m.alt || imageFallback;
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
   *  student opens a shared doc, and to remember the student's last choice. */
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

// ── remembered choice (1.1.147 M3) ───────────────────────────────────────
// A per-viewer convenience, so browser storage is the right place. Every
// access is guarded: storage can be absent or throw (private mode, blocked
// site data), and the panel must work without it.
const REMEMBER_PREFIX = "aipla.documents.selected:";

function readRemembered(activityId: string | undefined): string | null {
  if (!activityId) return null;
  try {
    return window.localStorage.getItem(REMEMBER_PREFIX + activityId);
  } catch {
    return null;
  }
}

function writeRemembered(activityId: string | undefined, docId: string): void {
  if (!activityId) return;
  try {
    window.localStorage.setItem(REMEMBER_PREFIX + activityId, docId);
  } catch {
    /* a convenience, not state */
  }
}

// `document.default_shown` is emitted once per chat session, however often
// the panel remounts (the workbench tabs unmount it when hidden).
const defaultShownSessions = new Set<string>();

/**
 * The Documents surface in the student workbench (1.1.33 M1; reader-first since
 * 1.1.147 M3):
 *  - **A reader that is already open** on the first shared document (the order
 *    the teacher attached them in), or on the student's last choice for this
 *    activity. More than one shared document → a visible switcher above it.
 *  - **Not shared** materials — cited by name below, collapsed, with a line
 *    saying the teacher has not shared the content (a copyright control).
 *  - **Your uploads** — the student's own photos, full-size on click.
 */
export function DocumentsPanel({
  materials,
  images,
  activityId,
  viewerRole = "student",
  sessionId = null,
}: DocumentsPanelProps) {
  // Hooks must run before any early return.
  const t = useT("DocumentsPanel");

  const sharedDocs = materials.filter((m) => m.studentVisible && m.kind !== "image");
  const sharedImages = materials.filter((m) => m.studentVisible && m.kind === "image");
  const hidden = materials.filter((m) => !m.studentVisible);
  const sharedKey = sharedDocs.map((m) => m.docId).join("\n");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  /** A document named in the chat that the teacher has not shared (M3b). */
  const [notSharedNotice, setNotSharedNotice] = useState<string | null>(null);
  const contentCache = useRef(new Map<string, DocContent>());
  const docEvents = useDocInteractionReporting(sessionId, selectedId);

  // The student's own choice: tab, select, or a document named in the chat.
  const choose = useCallback(
    (docId: string) => {
      setSelectedId(docId);
      setNotSharedNotice(null);
      writeRemembered(activityId, docId);
      // Research telemetry (1.1.45 M5) — only for a choice the student made.
      reportDocumentEvent(sessionId, { kind: "document.open", docId });
    },
    [activityId, sessionId],
  );

  // Open one by default: the remembered choice if it is still shared, else the
  // first shared document. Not a `document.open` — the student did not choose
  // it, and the telemetry must not record reading that never happened.
  useEffect(() => {
    const ids = sharedKey ? sharedKey.split("\n") : [];
    if (ids.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && ids.includes(selectedId)) return;
    const remembered = readRemembered(activityId);
    const pick = remembered && ids.includes(remembered) ? remembered : ids[0];
    setSelectedId(pick);
    if (sessionId && !defaultShownSessions.has(sessionId)) {
      defaultShownSessions.add(sessionId);
      reportDocumentEvent(sessionId, {
        kind: "document.default_shown",
        docId: pick,
        detail: { remembered: pick === remembered },
      });
    }
  }, [sharedKey, activityId, sessionId, selectedId]);

  // A document named in the chat (M3b). Shared → open it. Not shared → say so,
  // and fetch nothing. Consumed either way, so a remount does not replay it.
  const { request, consume } = useDocumentRequest();
  useEffect(() => {
    if (!request) return;
    const target = materials.find((m) => m.kind !== "image" && m.docId === request.docId);
    if (target?.studentVisible) choose(target.docId);
    else if (target) setNotSharedNotice(materialLabel(target, t("image")));
    consume(request.nonce);
  }, [request, materials, choose, consume, t]);

  // Load the selected document's content.
  useEffect(() => {
    if (!selectedId) {
      setView(null);
      return;
    }
    const cached = contentCache.current.get(selectedId);
    if (cached) {
      setView({ kind: "ready", content: cached });
      return;
    }
    let cancelled = false;
    setView({ kind: "loading" });
    fetchCurriculumContent(selectedId, activityId, { as: viewerRole })
      .then((content) => {
        if (cancelled) return;
        contentCache.current.set(selectedId, content);
        setView({ kind: "ready", content });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg =
          e instanceof CurriculumApiError && e.status === 403 ? t("noAccess") : t("loadFailed");
        setView({ kind: "error", message: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, activityId, viewerRole, t]);

  if (materials.length === 0 && images.length === 0) return null;

  const selected = sharedDocs.find((m) => m.docId === selectedId) ?? null;
  const selectedTitle = selected ? materialLabel(selected, t("image")) : "";

  return (
    <section className="flex flex-col gap-4 p-4" aria-label={t("heading")}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <FileText className="h-4 w-4" aria-hidden="true" />
        {t("heading")}
      </h2>

      {notSharedNotice !== null ? (
        <p
          role="status"
          className="flex items-start gap-1.5 rounded border border-dashed border-border bg-background px-2 py-1.5 text-xs text-muted-foreground"
        >
          <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">{notSharedNotice}</span> — {t("notShared")}
          </span>
        </p>
      ) : null}

      {selected ? (
        <div className="flex min-h-0 flex-col gap-2">
          {sharedDocs.length > 1 ? (
            <DocumentSwitcher
              docs={sharedDocs.map((m) => ({ docId: m.docId, title: materialLabel(m, t("image")) }))}
              selectedId={selected.docId}
              onSelect={choose}
              label={t("switcherLabel")}
            />
          ) : null}
          {/* The reader: INLINE in the workbench (not a modal) so the doc stays
              open alongside chat — the tutor refers to it while the student
              reads. This is the `workspace` surface (ADR-015). */}
          <div
            className="flex min-h-0 flex-col rounded-lg border border-border bg-muted/30"
            role={sharedDocs.length > 1 ? "tabpanel" : undefined}
            aria-label={t("openDocLabel", { title: selectedTitle })}
          >
            <div className="border-b border-border px-3 py-2">
              <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{selectedTitle}</span>
              </h3>
            </div>
            <div
              className="max-h-[55vh] min-h-0 overflow-auto px-3 py-2 text-sm"
              onCopy={docEvents.onCopy}
              onMouseUp={docEvents.onMouseUp}
              onScroll={docEvents.onScroll}
            >
              {view?.kind === "loading" ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t("loading")}
                </p>
              ) : view?.kind === "error" ? (
                <p className="text-destructive">{view.message}</p>
              ) : view?.kind === "ready" && !view.content.available ? (
                <p className="text-muted-foreground">{t("unavailable")}</p>
              ) : view?.kind === "ready" && !view.content.text.trim() ? (
                <p className="text-destructive">{t("empty")}</p>
              ) : view?.kind === "ready" ? (
                <>
                  <MarkdownBody text={view.content.text} />
                  {view.content.text.length < view.content.chars ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("truncated", { shown: view.content.text.length, total: view.content.chars })}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {sharedImages.length > 0 && activityId ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t("basedOn")}</p>
          <ul className="flex flex-col gap-1">
            {sharedImages.map((m) =>
              m.materialId ? (
                // 1.1.44 — image material: render the picture (the tutor sees it too).
                <li key={`img:${m.materialId}`}>
                  <ActivityImageThumb
                    activityId={activityId}
                    materialId={m.materialId}
                    alt={materialLabel(m, t("image"))}
                    role={viewerRole}
                    onFullscreen={() =>
                      reportDocumentEvent(sessionId, {
                        kind: "image.fullscreen",
                        materialId: m.materialId,
                      })
                    }
                  />
                </li>
              ) : null,
            )}
          </ul>
        </div>
      ) : null}

      {hidden.length > 0 ? (
        // Not-shared materials are CITED BY NAME (transparency) but their
        // content is not openable — the teacher's per-material toggle gates the
        // contents, not the name. Collapsed under a reader; open when there is
        // nothing else, so the panel never pretends something is openable.
        <details
          className="group flex flex-col gap-1.5"
          open={!selected && sharedImages.length === 0 ? true : undefined}
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("hiddenHeading")}
          </summary>
          <p className="mt-1.5 text-xs text-muted-foreground">{t("notShared")}</p>
          <ul className="mt-1.5 flex flex-col gap-1">
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
                <span className="truncate">{materialLabel(m, t("image"))}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {images.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
            {t("yourUploads")}
          </p>
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <ZoomableImage
                key={i}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt={t("yourUploadAlt")}
                triggerClassName="h-16 w-16 rounded-md border object-cover"
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Switch between shared documents (1.1.147 M3). Tabs at desktop width — the
 * point is that the other documents are SEEN to exist, which a dropdown hides —
 * and a native `<select>` on a narrow screen, where tabs would wrap into a wall.
 */
function DocumentSwitcher({
  docs,
  selectedId,
  onSelect,
  label,
}: {
  docs: { docId: string; title: string }[];
  selectedId: string;
  onSelect: (docId: string) => void;
  label: string;
}) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = docs.findIndex((d) => d.docId === selectedId);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % docs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + docs.length) % docs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = docs.length - 1;
    if (next === -1) return;
    e.preventDefault();
    const id = docs[next].docId;
    onSelect(id);
    tabRefs.current.get(id)?.focus();
  }

  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="hidden flex-wrap gap-1 min-[400px]:flex"
      >
        {docs.map((d) => {
          const isSelected = d.docId === selectedId;
          return (
            <button
              key={d.docId}
              ref={(el) => {
                if (el) tabRefs.current.set(d.docId, el);
                else tabRefs.current.delete(d.docId);
              }}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-label={d.title}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => {
                if (!isSelected) onSelect(d.docId);
              }}
              className={`flex max-w-full items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                isSelected
                  ? "border-primary/60 bg-muted font-semibold text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-muted hover:text-foreground"
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{d.title}</span>
            </button>
          );
        })}
      </div>
      <select
        aria-label={label}
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs min-[400px]:hidden"
      >
        {docs.map((d) => (
          <option key={d.docId} value={d.docId}>
            {d.title}
          </option>
        ))}
      </select>
    </>
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
  const t = useT("DocumentsPanel");
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
          <span className="truncate">{t("imageLoadFailed", { name: alt })}</span>
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
