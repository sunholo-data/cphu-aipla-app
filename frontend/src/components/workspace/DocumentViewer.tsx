"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  X,
} from "lucide-react";

import { ZoomableImage } from "@/components/chat/media/ZoomableImage";
import { fetchDocumentObjectUrl } from "@/lib/documentApi";

// Bundle the pdf.js worker locally (no external CDN fetch — ADR-013 / CSP).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/** One file in the viewer's tab strip (1.1.45 M2). */
export interface ViewerFile {
  docId: string;
  name: string;
  mimeType?: string;
}

function isPdf(f: ViewerFile): boolean {
  return (f.mimeType || "").includes("pdf") || f.name.toLowerCase().endsWith(".pdf");
}

function isImage(f: ViewerFile): boolean {
  return (f.mimeType || "").startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name);
}

/**
 * The workbench document viewer (1.1.45 M2 — JB-1 "din fil"): a file-tab strip
 * over an active file, rendered as a multi-page **PDF** (page-nav / zoom /
 * fullscreen / download), an **image** (zoom), or a download fallback. Bytes are
 * fetched auth-gated into an object URL. Lazy-loaded by its mount site so the
 * pdf.js bundle never reaches the chat first-load.
 */
export function DocumentViewer({
  files,
  role = "student",
  onActiveChange,
}: {
  files: ViewerFile[];
  role?: "student" | "teacher";
  onActiveChange?: (docId: string) => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const active = files[activeIdx] ?? files[0];

  useEffect(() => {
    if (active) onActiveChange?.(active.docId);
  }, [active, onActiveChange]);

  if (!active) return null;

  return (
    <section className="flex min-h-0 flex-col gap-2 p-2" aria-label="Document viewer">
      {files.length > 1 ? (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Files">
          {files.map((f, i) => (
            <button
              key={f.docId}
              type="button"
              role="tab"
              aria-selected={i === activeIdx}
              onClick={() => setActiveIdx(i)}
              className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                i === activeIdx
                  ? "border-primary/60 bg-primary/5 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-[12rem] truncate">{f.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      <ActiveFileView key={active.docId} file={active} role={role} />
    </section>
  );
}

function ActiveFileView({ file, role }: { file: ViewerFile; role: "student" | "teacher" }) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error" }
  >({ kind: "loading" });

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ kind: "loading" });
    fetchDocumentObjectUrl(file.docId, role)
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
  }, [file.docId, role]);

  if (state.kind === "loading") {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="flex items-center gap-1.5 rounded border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
        <X className="h-4 w-4 shrink-0" aria-hidden="true" />
        Couldn&apos;t open {file.name}.
      </div>
    );
  }

  if (isImage(file)) {
    return (
      <ZoomableImage
        src={state.url}
        alt={file.name}
        triggerClassName="max-h-[60vh] w-full rounded-md border border-border object-contain"
      />
    );
  }
  if (isPdf(file)) {
    return <PdfView url={state.url} name={file.name} />;
  }
  // Unknown type → honest download fallback (Axiom 5).
  return (
    <a
      href={state.url}
      download={file.name}
      className="flex items-center gap-1.5 rounded border border-border px-3 py-2 text-sm hover:bg-muted"
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      Download {file.name}
    </a>
  );
}

function PdfView({ url, name }: { url: string; name: string }) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="flex min-h-0 flex-col rounded-md border border-border bg-muted/20">
      <div ref={wrapRef} className="min-h-0 overflow-auto p-2">
        <Document
          file={url}
          onLoadSuccess={({ numPages: n }) => {
            setNumPages(n);
            setPage(1);
          }}
          loading={
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            </div>
          }
          error={<p className="p-4 text-sm text-destructive">Couldn&apos;t render this PDF.</p>}
        >
          <Page pageNumber={page} scale={scale} renderTextLayer renderAnnotationLayer />
        </Document>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5 text-xs">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded p-1 hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="tabular-nums">
            {page} / {numPages || "…"}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={numPages > 0 && page >= numPages}
            onClick={() => setPage((p) => (numPages ? Math.min(numPages, p + 1) : p + 1))}
            className="rounded p-1 hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setScale((s) => Math.max(0.5, Math.round((s - 0.1) * 10) / 10))}
            className="rounded p-1 hover:bg-muted"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="tabular-nums">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setScale((s) => Math.min(3, Math.round((s + 0.1) * 10) / 10))}
            className="rounded p-1 hover:bg-muted"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Fullscreen"
            onClick={() => wrapRef.current?.requestFullscreen?.()}
            className="rounded p-1 hover:bg-muted"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <a href={url} download={name} aria-label="Download" className="rounded p-1 hover:bg-muted">
            <Download className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
