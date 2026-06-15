"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Check, Eye, EyeOff, FileUp, Loader2, Plus, X } from "lucide-react";

import {
  type CurriculumDoc,
  CurriculumApiError,
  browseCurriculum,
  ingestCurriculum,
} from "@/lib/curriculumApi";
import type { MaterialRef, StxLevel } from "@/lib/teacherApi";

interface Props {
  /** Currently-cited materials (controlled by the parent builder). */
  materials: MaterialRef[];
  /** Called whenever the cited set changes (cite/un-cite/upload). */
  onChange: (next: MaterialRef[]) => void;
}

const LEVELS: StxLevel[] = ["A", "B", "C"];

/**
 * Materials section for the activity builder (1.1.25 M4).
 *
 * Three affordances:
 *   - Browse the A/B/C curriculum library (filter by level + topic)
 *   - Cite a library doc → adds a MaterialRef to the activity
 *   - Upload your own doc → ingests (teacher_owned) then cites it
 *
 * The tutor's curriculum-retrieval tool (M3) is scoped to exactly these
 * cited docs — students never see the open corpus. Empty / loading / error
 * states are designed (Axiom 11).
 */
export function MaterialsSection({ materials, onChange }: Props) {
  const [docs, setDocs] = useState<CurriculumDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<StxLevel | "">("");
  const [topicFilter, setTopicFilter] = useState("");

  const citedIds = new Set(materials.map((m) => m.docId));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await browseCurriculum({
        level: levelFilter || undefined,
        topic: topicFilter.trim() || undefined,
      });
      setDocs(result);
    } catch (e) {
      if (e instanceof CurriculumApiError && e.status === 403) {
        setError("Curriculum library is teacher-only — sign in as a teacher.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to load the curriculum library.");
      }
      setDocs(null);
    } finally {
      setLoading(false);
    }
  }, [levelFilter, topicFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleCite(doc: CurriculumDoc) {
    if (citedIds.has(doc.docId)) {
      onChange(materials.filter((m) => m.docId !== doc.docId));
    } else {
      // Default not student-visible (opt-in, 1.1.33 M2a) — the teacher reveals
      // it deliberately. Grounding uses it either way.
      onChange([...materials, { docId: doc.docId, origin: doc.origin, studentVisible: false }]);
    }
  }

  function toggleStudentVisible(docId: string) {
    onChange(
      materials.map((m) =>
        m.docId === docId ? { ...m, studentVisible: !m.studentVisible } : m,
      ),
    );
  }

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="flex items-center gap-1.5 text-sm font-medium">
        <BookOpen className="h-4 w-4" aria-hidden="true" />
        Materials
      </legend>
      <p className="text-xs text-muted-foreground">
        Cite curriculum documents so the tutor can ground its answers with a
        source. The tutor uses every cited document; students only see the ones
        you mark <span className="font-medium">visible</span>.
      </p>

      {/* Cited materials chips — each with a per-material student-visibility toggle (1.1.33 M2a) */}
      {materials.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Cited materials">
          {materials.map((m) => {
            const label = m.origin || m.docId;
            const visible = Boolean(m.studentVisible);
            return (
              <li
                key={m.docId}
                className="flex items-center gap-1.5 rounded border border-primary/40 bg-primary/5 px-2 py-1 text-xs"
              >
                <span className="font-medium">{label}</span>
                <button
                  type="button"
                  aria-pressed={visible}
                  aria-label={
                    visible
                      ? `Hide ${label} from students`
                      : `Show ${label} to students`
                  }
                  title={visible ? "Visible to students" : "Hidden from students"}
                  onClick={() => toggleStudentVisible(m.docId)}
                  className={
                    visible
                      ? "flex items-center gap-1 rounded px-1 text-emerald-700 hover:text-emerald-800"
                      : "flex items-center gap-1 rounded px-1 text-muted-foreground hover:text-foreground"
                  }
                >
                  {visible ? (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>{visible ? "Visible" : "Hidden"}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() =>
                    onChange(materials.filter((x) => x.docId !== m.docId))
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Level
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as StxLevel | "")}
            aria-label="Filter by level"
            className="rounded border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Topic
          <input
            type="text"
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
            placeholder="e.g. mechanics"
            aria-label="Filter by topic"
            className="rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <UploadButton onUploaded={(doc) => {
          // Add the new doc to the visible list + cite it immediately. Default
          // not student-visible (opt-in, 1.1.33 M2a) — same as toggleCite.
          setDocs((prev) => (prev ? [doc, ...prev] : [doc]));
          onChange([...materials, { docId: doc.docId, origin: doc.origin, studentVisible: false }]);
        }} />
      </div>

      {/* Library list */}
      <div className="rounded border border-border">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading library…
          </div>
        ) : error ? (
          <div className="flex flex-col gap-2 p-4 text-sm">
            <span className="text-destructive">{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="w-fit rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
            >
              Retry
            </button>
          </div>
        ) : !docs || docs.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No documents yet. Browse the shared A/B/C library or upload your own.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {docs.map((doc) => {
              const cited = citedIds.has(doc.docId);
              return (
                <li
                  key={doc.docId}
                  className="flex items-center justify-between gap-3 p-3 text-sm"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">{doc.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {doc.origin}
                      {doc.level ? ` · Level ${doc.level}` : ""}
                      {doc.topic ? ` · ${doc.topic}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleCite(doc)}
                    aria-pressed={cited}
                    aria-label={cited ? `Remove ${doc.title}` : `Cite ${doc.title}`}
                    className={`flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition-colors ${
                      cited
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {cited ? (
                      <>
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Cited
                      </>
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        Cite
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </fieldset>
  );
}

// -----------------------------------------------------------------------------
// Upload sub-control — minimal inline upload that ingests then cites.
// -----------------------------------------------------------------------------

function UploadButton({
  onUploaded,
}: {
  onUploaded: (doc: CurriculumDoc) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 1.1.33 M4 — what AILANG Parse extracted from the last upload, so the teacher
  // can verify the parse before it grounds the tutor.
  const [preview, setPreview] = useState<{ text: string; chars: number } | null>(null);

  async function handleFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setBusy(true);
    setErr(null);
    setPreview(null);
    try {
      const result = await ingestCurriculum({
        file,
        title: file.name.replace(/\.[^.]+$/, ""),
        // 1.1.33: uploads are level-less (no forced "B" — the teacher may file
        // it A/B/C later). origin is the filename so the citation is recognisable.
        origin: file.name,
      });
      onUploaded(result.doc);
      setPreview({ text: result.parsedPreview, chars: result.parsedChars });
    } catch (e) {
      if (e instanceof CurriculumApiError && e.status === 422) {
        setErr("Unsupported file. Convert PDFs to .docx or .txt first.");
      } else {
        setErr(e instanceof Error ? e.message : "Upload failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <FileUp className="h-4 w-4" aria-hidden="true" />
        )}
        {busy ? "Uploading…" : "Upload"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.md,.docx,.pptx,.xlsx,.odt,.odp,.ods,.epub,.html,.htm,.csv"
        onChange={handleFile}
        className="hidden"
        aria-label="Upload curriculum document"
      />
      {err ? <span className="text-xs text-destructive">{err}</span> : null}
      {preview ? (
        <details className="mt-1 rounded border border-border bg-muted/30 text-xs">
          <summary className="cursor-pointer px-2 py-1 font-medium">
            What we extracted{" "}
            <span className="font-normal text-muted-foreground">
              ({preview.chars.toLocaleString()} characters
              {preview.text.length < preview.chars ? ", preview truncated" : ""})
            </span>
          </summary>
          {preview.text.trim() ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap px-2 py-1 font-sans text-muted-foreground">
              {preview.text}
            </pre>
          ) : (
            <p className="px-2 py-1 text-destructive">
              Nothing was extracted — check the file parsed correctly before relying on it.
            </p>
          )}
        </details>
      ) : null}
    </div>
  );
}
