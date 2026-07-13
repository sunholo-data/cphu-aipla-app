"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, Check, Eye, EyeOff, FileText, FileUp, Image as ImageIcon, Loader2, Plus, Tag, X } from "lucide-react";

import {
  type CurriculumDoc,
  type DocContent,
  CurriculumApiError,
  browseCurriculum,
  fetchCurriculumContent,
  ingestCurriculum,
  listCurriculumFacets,
  patchCurriculumTags,
} from "@/lib/curriculumApi";
import { ActivityImageApiError, deleteActivityImage, uploadActivityImage } from "@/lib/activityImageApi";
import type { MaterialRef, StxLevel } from "@/lib/teacherApi";

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; content: DocContent }
  | { kind: "error"; message: string };

interface Props {
  /** Currently-cited materials (controlled by the parent builder). */
  materials: MaterialRef[];
  /** Called whenever the cited set changes (cite/un-cite/upload). */
  onChange: (next: MaterialRef[]) => void;
  /** The activity id — required to attach an image (1.1.44). Both builder pages
   *  have one (edit: route param; new: the resolved concept skill id). When
   *  absent, image upload is disabled with an explanatory message. */
  activityId?: string;
}

const LEVELS: StxLevel[] = ["A", "B", "C"];
// 1.1.59 — page size for the paginated browse (server caps at 200).
const PAGE_SIZE = 50;

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
export function MaterialsSection({ materials, onChange, activityId }: Props) {
  const [docs, setDocs] = useState<CurriculumDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<StxLevel | "">("");
  const [topicFilter, setTopicFilter] = useState("");
  // 1.1.59 — debounced search term (the input updates on every keystroke; the
  // browse only fires 250ms after typing settles) + pagination state.
  const [debouncedTopic, setDebouncedTopic] = useState("");
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // 1.1.58 M1 — tag facet: the tags available to click, and the selected subset
  // (AND). `editTagsFor` holds the docId whose inline tag editor is open.
  const [facetTags, setFacetTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [editTagsFor, setEditTagsFor] = useState<string | null>(null);

  // Only curriculum materials map to library docs; image materials carry no docId.
  const citedIds = new Set(materials.filter((m) => m.kind !== "image").map((m) => m.docId));

  // 1.1.59 — debounce the search input so a large corpus isn't re-queried on
  // every keystroke (the browse loads the shared corpus; per-keystroke fetches
  // are the exact cost this milestone removes).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTopic(topicFilter.trim()), 250);
    return () => clearTimeout(t);
  }, [topicFilter]);

  const browseParams = useCallback(
    (offset: number) => ({
      level: levelFilter || undefined,
      topic: debouncedTopic || undefined,
      tags: selectedTags.length ? selectedTags : undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [levelFilter, debouncedTopic, selectedTags],
  );

  // Load the FIRST page — replaces the list. Re-runs when a filter/search changes.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await browseCurriculum(browseParams(0));
      setDocs(page.docs);
      setTotal(page.total);
    } catch (e) {
      if (e instanceof CurriculumApiError && e.status === 403) {
        setError("Curriculum library is teacher-only — sign in as a teacher.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to load the curriculum library.");
      }
      setDocs(null);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [browseParams]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fetch the NEXT page and APPEND (never replace) — the large-list affordance.
  async function loadMore() {
    if (!docs) return;
    setLoadingMore(true);
    try {
      const page = await browseCurriculum(browseParams(docs.length));
      setDocs((prev) => (prev ? [...prev, ...page.docs] : page.docs));
      setTotal(page.total);
    } catch {
      // Keep what we already have; the teacher can retry.
    } finally {
      setLoadingMore(false);
    }
  }

  // Populate the facet chips once (and after a tag edit refreshes them).
  const loadFacets = useCallback(async () => {
    try {
      const { tags } = await listCurriculumFacets();
      setFacetTags(tags);
    } catch {
      // Facets are additive — a failure just means no chip row, never a blocker.
      setFacetTags([]);
    }
  }, []);

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);

  function toggleTagFilter(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  // Persist a tag edit for one doc, then reflect it locally + refresh facets so a
  // brand-new tag becomes a filterable chip.
  async function applyTagEdit(docId: string, body: { addTags?: string[]; removeTags?: string[] }) {
    try {
      const updated = await patchCurriculumTags(docId, body);
      setDocs((prev) => (prev ? prev.map((d) => (d.docId === docId ? updated : d)) : prev));
      void loadFacets();
    } catch {
      // Non-fatal: the row keeps its prior tags; the teacher can retry.
    }
  }

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

  // 1.1.33 M4/M3 — "what we extracted" is per-document: click any cited or
  // library doc to read exactly what was parsed from IT (not a generic panel).
  const [viewDoc, setViewDoc] = useState<{ docId: string; title: string } | null>(null);
  const [view, setView] = useState<ViewState | null>(null);

  async function openContent(docId: string, title: string) {
    setViewDoc({ docId, title });
    setView({ kind: "loading" });
    try {
      // Teacher path — no activityId; ACL allows own/shared docs.
      const content = await fetchCurriculumContent(docId);
      setView({ kind: "ready", content });
    } catch (e) {
      setView({
        kind: "error",
        message:
          e instanceof CurriculumApiError && e.status === 403
            ? "You don't have access to this document."
            : "Couldn't load this document.",
      });
    }
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
            // 1.1.44 — image materials: an icon chip (the tutor sees the image;
            // there's no text-extraction viewer). Same visibility toggle + remove.
            if (m.kind === "image") {
              const imgLabel = m.alt || "Image";
              const imgVisible = Boolean(m.studentVisible);
              return (
                <li
                  key={`img:${m.materialId}`}
                  className="flex items-center gap-1.5 rounded border border-primary/40 bg-primary/5 px-2 py-1 text-xs"
                >
                  <span className="flex items-center gap-1 font-medium">
                    <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {imgLabel}
                  </span>
                  <button
                    type="button"
                    aria-pressed={imgVisible}
                    aria-label={imgVisible ? `Hide ${imgLabel} from students` : `Show ${imgLabel} to students`}
                    title={imgVisible ? "Visible to students" : "Hidden from students"}
                    onClick={() =>
                      onChange(
                        materials.map((x) =>
                          x.kind === "image" && x.materialId === m.materialId
                            ? { ...x, studentVisible: !x.studentVisible }
                            : x,
                        ),
                      )
                    }
                    className={
                      imgVisible
                        ? "flex items-center gap-1 rounded px-1 text-emerald-700 hover:text-emerald-800"
                        : "flex items-center gap-1 rounded px-1 text-muted-foreground hover:text-foreground"
                    }
                  >
                    {imgVisible ? (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{imgVisible ? "Visible" : "Hidden"}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${imgLabel}`}
                    onClick={() => {
                      if (activityId && m.materialId) {
                        void deleteActivityImage(activityId, m.materialId).catch(() => {});
                      }
                      onChange(materials.filter((x) => !(x.kind === "image" && x.materialId === m.materialId)));
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            }
            const label = m.origin || m.docId;
            const visible = Boolean(m.studentVisible);
            return (
              <li
                key={m.docId}
                className="flex items-center gap-1.5 rounded border border-primary/40 bg-primary/5 px-2 py-1 text-xs"
              >
                <button
                  type="button"
                  onClick={() => openContent(m.docId, label)}
                  title="View what was extracted"
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {label}
                </button>
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
        <UploadButton
          activityId={activityId}
          onUploaded={(doc) => {
            // Add the new doc to the visible list + cite it immediately. Default
            // not student-visible (opt-in, 1.1.33 M2a) — same as toggleCite.
            setDocs((prev) => (prev ? [doc, ...prev] : [doc]));
            setTotal((t) => t + 1);
            onChange([...materials, { docId: doc.docId, origin: doc.origin, studentVisible: false }]);
            // Show what was extracted FROM THIS doc immediately (per-document, M4).
            void openContent(doc.docId, doc.title);
          }}
          onImageUploaded={(ref) => {
            // 1.1.44 — an image material the tutor will SEE. Cite it immediately;
            // no parse viewer (it isn't text-extracted).
            onChange([...materials, ref]);
          }}
        />
      </div>

      {/* Tag facet chips (1.1.58 M1) — click to narrow by tag (AND). Absent when
          no docs carry tags yet, so the row never shows as an empty affordance. */}
      {facetTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter by tag">
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Tag className="h-3.5 w-3.5" aria-hidden="true" />
            Tags
          </span>
          {facetTags.map((tag) => {
            const on = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTagFilter(tag)}
                aria-pressed={on}
                className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {tag}
              </button>
            );
          })}
          {selectedTags.length > 0 ? (
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear tags
            </button>
          ) : null}
        </div>
      ) : null}

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
                    <button
                      type="button"
                      onClick={() => openContent(doc.docId, doc.title)}
                      title="View what was extracted"
                      className="truncate text-left font-medium underline-offset-2 hover:underline"
                    >
                      {doc.title}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {doc.origin}
                      {doc.level ? ` · Level ${doc.level}` : ""}
                      {doc.topic ? ` · ${doc.topic}` : ""}
                    </span>
                    {doc.summary ? (
                      <span className="line-clamp-2 text-xs text-muted-foreground/80">{doc.summary}</span>
                    ) : null}
                    {/* Tags (1.1.58 M1) — chips with remove; an inline add editor. */}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {doc.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {tag}
                          {editTagsFor === doc.docId ? (
                            <button
                              type="button"
                              aria-label={`Remove tag ${tag} from ${doc.title}`}
                              onClick={() => void applyTagEdit(doc.docId, { removeTags: [tag] })}
                              className="hover:text-foreground"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {editTagsFor === doc.docId ? (
                        <input
                          type="text"
                          autoFocus
                          placeholder="add tag, Enter"
                          aria-label={`Add a tag to ${doc.title}`}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const val = e.currentTarget.value.trim();
                              if (val) void applyTagEdit(doc.docId, { addTags: [val] });
                              e.currentTarget.value = "";
                            } else if (e.key === "Escape") {
                              setEditTagsFor(null);
                            }
                          }}
                          className="w-28 rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
                        />
                      ) : null}
                      <button
                        type="button"
                        aria-label={
                          editTagsFor === doc.docId
                            ? `Done editing tags for ${doc.title}`
                            : doc.tags.length === 0
                              ? `Add tags for ${doc.title}`
                              : `Edit tags for ${doc.title}`
                        }
                        onClick={() => setEditTagsFor((cur) => (cur === doc.docId ? null : doc.docId))}
                        className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        {editTagsFor === doc.docId ? (
                          <>
                            <Check className="h-3 w-3" aria-hidden="true" />
                            Done
                          </>
                        ) : (
                          <>
                            <Tag className="h-3 w-3" aria-hidden="true" />
                            {doc.tags.length === 0 ? "Add tags" : "Edit"}
                          </>
                        )}
                      </button>
                    </div>
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
        {/* 1.1.59 — large-list footer: honest count + load-more (never an
            unbounded dump). Shown only once a page is loaded. */}
        {docs && docs.length > 0 ? (
          <div className="flex items-center justify-between gap-3 border-t border-border p-2 text-xs text-muted-foreground">
            <span>
              Showing {docs.length} of {total}
            </span>
            {docs.length < total ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 font-medium hover:bg-muted disabled:opacity-60"
              >
                {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                Load more
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Per-document "what we extracted" viewer (M4/M3). */}
      <Dialog.Root
        open={viewDoc !== null}
        onOpenChange={(o) => {
          if (!o) {
            setViewDoc(null);
            setView(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
              <Dialog.Title className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">What we extracted — {viewDoc?.title}</span>
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
                  This document was added before content viewing existed — re-upload it to see what
                  was extracted.
                </p>
              ) : view?.kind === "ready" && !view.content.text.trim() ? (
                <p className="text-destructive">
                  Nothing was extracted — check the file parsed correctly before relying on it.
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
    </fieldset>
  );
}

// -----------------------------------------------------------------------------
// Upload sub-control — minimal inline upload that ingests then cites.
// -----------------------------------------------------------------------------

const _IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;

function UploadButton({
  activityId,
  onUploaded,
  onImageUploaded,
}: {
  activityId?: string;
  onUploaded: (doc: CurriculumDoc) => void;
  onImageUploaded: (ref: MaterialRef) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      // 1.1.44 — route by type: an image becomes a material the tutor SEES
      // (stored in the activity artifact slot); anything else is text-extracted
      // into the curriculum/RAG corpus.
      if (_IMAGE_EXT_RE.test(file.name)) {
        if (!activityId) {
          setErr("Save the activity before adding an image.");
          return;
        }
        const ref = await uploadActivityImage(activityId, file, file.name.replace(/\.[^.]+$/, ""));
        onImageUploaded(ref);
        return;
      }
      const result = await ingestCurriculum({
        file,
        title: file.name.replace(/\.[^.]+$/, ""),
        // 1.1.33: uploads are level-less (no forced "B" — the teacher may file
        // it A/B/C later). origin is the filename so the citation is recognisable.
        origin: file.name,
      });
      // The parent cites it + opens the per-document "what we extracted" viewer
      // (M4/M3) — so the preview is tied to the doc, not a generic panel.
      onUploaded(result.doc);
    } catch (e) {
      if ((e instanceof CurriculumApiError || e instanceof ActivityImageApiError) && e.status === 422) {
        // 422 = a genuinely unsupported type (PDFs/images are supported).
        setErr(e.message || "Unsupported file type.");
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
        accept=".pdf,.txt,.md,.docx,.pptx,.xlsx,.odt,.odp,.ods,.epub,.html,.htm,.csv,.png,.jpg,.jpeg,.webp,.gif"
        onChange={handleFile}
        className="hidden"
        aria-label="Upload document or image"
      />
      {err ? <span className="text-xs text-destructive">{err}</span> : null}
    </div>
  );
}
