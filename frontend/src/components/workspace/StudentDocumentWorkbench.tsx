"use client";

import dynamic from "next/dynamic";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

import {
  DocumentApiError,
  deleteDocument,
  listMyDocuments,
  uploadDocument,
  type MyDocument,
} from "@/lib/documentApi";
import { encodedImageToFile, resizeImageFile } from "@/lib/imageResize";
import type { ViewerFile } from "./DocumentViewer";

// pdf.js is heavy — keep it out of the chat first-load. Only a document-feedback
// activity mounts this surface, and only then does the viewer (+ pdf.js) load.
const DocumentViewer = dynamic(() => import("./DocumentViewer").then((m) => m.DocumentViewer), {
  ssr: false,
  loading: () => (
    <div className="flex h-40 items-center justify-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
    </div>
  ),
});

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; docs: MyDocument[] };

interface StudentDocumentWorkbenchProps {
  /** The activity's skillId — scopes the document list + upload to this activity. */
  skillId: string;
  /** Active chat session; null in the builder preview (no tutor). */
  sessionId?: string | null;
  /** Whose token reads/writes: student (group token) or teacher (builder preview). */
  role?: "student" | "teacher";
  /** Fires with the active file's docId (or null when none) so the chat page can
   *  push it into the tutor's document_ids — the tutor critiques the active file
   *  (wired in M3b.3). */
  onActiveDocChange?: (docId: string | null) => void;
}

// One upload, the system routes (1.1.122). A student never chooses a surface by
// file TYPE: a document is parsed to text, an image is stored as pixels and
// reaches the tutor as an image Part (adk/callbacks/document.py branches on the
// record's mediaKind) — never through OCR, the path 1.1.48 rejected for
// handwriting. Before 1.1.122 this list excluded images and a student turned
// a photo of a drawn equation into a PDF to get past the gate. Mirrors the
// backend _ALLOWED_EXTENSIONS (tools/documents/upload.py) — keep in sync.
const ACCEPT = ".pdf,.txt,.md,.docx,.csv,.xlsx,.pptx,.jpg,.jpeg,.png,.webp,.heic,.heif";
const ACCEPT_LABEL = "PDF, Word, Excel, PowerPoint, tekst, Markdown, CSV eller et billede (JPG, PNG, HEIC)";
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
}

function isImageDoc(d: MyDocument): boolean {
  return IMAGE_EXT.test(d.name) || ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(d.sourceFormat);
}

// Every user-facing string on this surface, in one place (1.1.108). Danish is
// the surface's language today; the locale axis arrives with the message layer.
const copy = {
  upload: "Upload fil eller billede",
  emptyTitle: "Du har ikke uploadet noget endnu.",
  emptyHint: "Upload din opgave eller et billede af dit arbejde, så kan tutoren give dig feedback.",
  yourFiles: "Dine filer",
  yourDocuments: "Dine dokumenter",
  retry: "Prøv igen",
  listFailed: "Kunne ikke hente dine eksisterende filer. Du kan stadig uploade en ny ovenfor.",
  deleteFailed: "Kunne ikke slette filen. Prøv igen.",
  uploadFailed: "Kunne ikke uploade filen. Prøv igen.",
  unsupported: `Denne filtype understøttes ikke her. Tilladte typer: ${ACCEPT_LABEL}.`,
  tooLarge: (mb: string, max: number) =>
    `Filen er for stor (${mb} MB). Maks er ${max} MB — prøv at komprimere den, eller upload færre sider ad gangen.`,
  tooLargeServer: (max: number) =>
    `Filen er for stor. Maks er ${max} MB — prøv at komprimere den, eller upload færre sider ad gangen.`,
  parseFailed:
    "Filen blev uploadet, men kunne ikke læses, så tutoren kan ikke se den. Prøv at gemme den som PDF og uploade igen.",
  deleteLabel: (name: string) => `Slet ${name}`,
};

// Mirrors the backend's _MAX_UPLOAD_BYTES (tools/documents/upload.py) — keep in
// sync. Checked client-side BEFORE the network call: a file over this size can
// otherwise sit "uploading" with no feedback for as long as the student's
// connection takes to push it, only to be rejected at the end anyway (or worse,
// time out with no error at all — the 2026-09-15 prod report this guards).
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

// The backend 400s with a specific reason (wrong file type is the only case
// reachable here today — the input's `accept` filters the OS picker, but some
// mobile browsers ignore it loosely). Give the student that reason instead of
// a one-size-fits-all "try again" that hides what actually went wrong.
function uploadErrorMessage(err: unknown): string {
  if (err instanceof DocumentApiError && err.status === 400) return copy.unsupported;
  if (err instanceof DocumentApiError && err.status === 413) return copy.tooLargeServer(MAX_UPLOAD_MB);
  return copy.uploadFailed;
}

/**
 * StudentDocumentWorkbench (1.1.45 M3b) — the workbench surface for a
 * document-feedback activity (JB-1 "din fil"). The student uploads their own
 * work, the files appear as tabs, and the active file renders in the viewer and
 * is handed to the tutor for critique. Self-contained: owns the file list,
 * upload, delete, and active-file selection; delegates rendering of the active
 * file to the (lazy) DocumentViewer.
 *
 * Student-facing → group token (`fetchWithAuth`, via documentApi `role`). The
 * builder preview passes role="teacher" so the teacher's own uploads render
 * without a real activity to ACL against.
 */
export function StudentDocumentWorkbench({
  skillId,
  sessionId: _sessionId = null,
  role = "student",
  onActiveDocChange,
}: StudentDocumentWorkbenchProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(
    async (preferDocId?: string) => {
      try {
        const docs = await listMyDocuments(skillId, role);
        setState({ kind: "ready", docs });
        setActiveId((prev) => {
          const wanted = preferDocId ?? prev;
          if (wanted && docs.some((d) => d.docId === wanted)) return wanted;
          return docs[0]?.docId ?? null;
        });
      } catch {
        setState({ kind: "error" });
      }
    },
    [skillId, role],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Surface the active file to the caller (→ tutor document_ids in M3b.3).
  useEffect(() => {
    onActiveDocChange?.(activeId);
  }, [activeId, onActiveDocChange]);

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same filename
    if (!picked) return;
    if (picked.size > MAX_UPLOAD_BYTES) {
      const mb = (picked.size / (1024 * 1024)).toFixed(1);
      setActionError(copy.tooLarge(mb, MAX_UPLOAD_MB));
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      // A photo is downscaled on device first (1.1.7's ≤2048px JPEG — a
      // 12-megapixel phone shot becomes a few hundred KB) and then takes the
      // SAME route as a PDF. HEIC passes through untouched, as on the chat path.
      const file = isImageFile(picked) ? encodedImageToFile(await resizeImageFile(picked), picked.name) : picked;
      const { docId, status } = await uploadDocument(file, skillId, role);
      await refresh(docId);
      // Stored but unreadable: only a parsed document is listed or reaches the
      // tutor, so without this line a failed parse looks exactly like "nothing
      // happened" (prod 2026-09-16 — every .docx, expired parse key).
      if (status === "failed") setActionError(copy.parseFailed);
    } catch (err) {
      setActionError(uploadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(docId: string) {
    setBusy(true);
    setActionError(null);
    try {
      await deleteDocument(docId, role);
      await refresh();
    } catch {
      setActionError(copy.deleteFailed);
    } finally {
      setBusy(false);
    }
  }

  const docs = state.kind === "ready" ? state.docs : [];
  const activeDoc = docs.find((d) => d.docId === activeId) ?? null;
  const activeFile: ViewerFile | null = activeDoc
    ? { docId: activeDoc.docId, name: activeDoc.name }
    : null;

  function openPicker() {
    fileInputRef.current?.click();
  }

  return (
    <section className="flex min-h-0 flex-col gap-2 p-2" aria-label={copy.yourDocuments}>
      {/* Upload is always available once we're past the initial load — a failed
          LIST must never block the student from uploading their work. */}
      {state.kind !== "loading" ? (
        <div className="flex flex-wrap items-center gap-1">
          {docs.length > 0 ? (
            <div role="tablist" aria-label={copy.yourFiles} className="flex flex-wrap gap-1">
              {docs.map((d) => {
                const selected = d.docId === activeId;
                return (
                  <span
                    key={d.docId}
                    className={`inline-flex items-center rounded border text-xs ${
                      selected
                        ? "border-primary/60 bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveId(d.docId)}
                      className={`flex items-center gap-1.5 py-1 pl-2 ${selected ? "font-medium" : "hover:text-foreground"}`}
                    >
                      {isImageDoc(d) ? (
                        <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span className="max-w-[11rem] truncate">{d.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={copy.deleteLabel(d.name)}
                      disabled={busy}
                      onClick={() => onDelete(d.docId)}
                      className="px-1.5 py-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {copy.upload}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={onPickFile}
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-xs text-destructive">
          {actionError}
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        </div>
      ) : state.kind === "error" ? (
        <div className="flex flex-col items-start gap-2 rounded border border-border bg-background p-4 text-sm text-muted-foreground">
          <p>{copy.listFailed}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            {copy.retry}
          </button>
        </div>
      ) : activeFile ? (
        <DocumentViewer key={activeFile.docId} files={[activeFile]} role={role} />
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-8 text-center">
          <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {copy.emptyTitle}
            <br />
            {copy.emptyHint}
          </p>
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {copy.upload}
          </button>
        </div>
      )}
    </section>
  );
}
