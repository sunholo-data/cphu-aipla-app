"use client";

import dynamic from "next/dynamic";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";

import {
  deleteDocument,
  listMyDocuments,
  uploadDocument,
  type MyDocument,
} from "@/lib/documentApi";
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

// AILANG-parseable formats the student can attach (mirrors the backend allow-list).
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.docx,.csv,.xlsx,.pptx";

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
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same filename
    if (!file) return;
    setBusy(true);
    setActionError(null);
    try {
      const { docId } = await uploadDocument(file, skillId, role);
      await refresh(docId);
    } catch {
      setActionError("Kunne ikke uploade filen. Prøv igen.");
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
      setActionError("Kunne ikke slette dokumentet. Prøv igen.");
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
    <section className="flex min-h-0 flex-col gap-2 p-2" aria-label="Dine dokumenter">
      {/* Upload is always available once we're past the initial load — a failed
          LIST must never block the student from uploading their work. */}
      {state.kind !== "loading" ? (
        <div className="flex flex-wrap items-center gap-1">
          {docs.length > 0 ? (
            <div role="tablist" aria-label="Dine filer" className="flex flex-wrap gap-1">
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
                      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="max-w-[11rem] truncate">{d.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Slet ${d.name}`}
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
            Upload fil
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
          <p>Kunne ikke hente dine eksisterende filer. Du kan stadig uploade en ny ovenfor.</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            Prøv igen
          </button>
        </div>
      ) : activeFile ? (
        <DocumentViewer key={activeFile.docId} files={[activeFile]} role={role} />
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-8 text-center">
          <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Du har ikke uploadet nogen filer endnu.
            <br />
            Upload din opgave, så kan tutoren give dig feedback på den.
          </p>
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload fil
          </button>
        </div>
      )}
    </section>
  );
}
