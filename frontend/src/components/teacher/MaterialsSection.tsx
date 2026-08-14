"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, Check, Eye, EyeOff, FileText, FileUp, Folder, FolderPlus, Image as ImageIcon, Loader2, Plus, Tag, Trash2, X } from "lucide-react";

import {
  type CurriculumDoc,
  type CurriculumFacets,
  type CurriculumFolder,
  type DocContent,
  type FacetOption,
  type LevelFilter,
  CurriculumApiError,
  UNLEVELLED,
  browseCurriculum,
  createCurriculumFolder,
  deleteCurriculumDoc,
  deleteCurriculumFolder,
  fetchCurriculumContent,
  ingestCurriculum,
  listCurriculumFacets,
  listCurriculumFolders,
  patchCurriculumTags,
} from "@/lib/curriculumApi";
import { ActivityImageApiError, deleteActivityImage, uploadActivityImage } from "@/lib/activityImageApi";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import type { MaterialRef } from "@/lib/teacherApi";
// 1.1.61 — the chip idiom moved out so the activity library shares it verbatim
// rather than growing a lookalike. Behaviour here is unchanged.
import { ALL, ActiveChip, FacetRow } from "@/components/teacher/ui/FacetRow";

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
  /** 1.1.61 — which job this mount is doing.
   *
   *  `"cite"` (default) is the activity-builder mount: browse the corpus and
   *  pick documents for THIS activity, so every row carries a Cite button and
   *  the cited set renders above the filters.
   *
   *  `"library"` is the standalone `/teacher/materials` mount: curate the
   *  corpus itself — subject, folder, tags, upload — with no activity in scope.
   *  Citing is meaningless there, so the Cite column and the cited-set header
   *  are dropped and the organise editor is the primary affordance. */
  mode?: "cite" | "library";
}

// 1.1.59 — page size for the paginated browse (server caps at 200).
const PAGE_SIZE = 50;
// 1.1.58 M3 — sentinel folder filter → docs with no folder (mirrors backend).
const UNFILED = "__unfiled__";
// The empty-string value every single-select facet uses for "no filter".
// 1.1.60 — subject is the BROAD class (mirrors backend SUBJECTS in
// db/models/curriculum.py). It used to be the nine Danish stx *physics* areas,
// which left the maths corpus homeless and "AIPLA guides" posing as a physics
// area; those areas are now FOLDERS. Free entry isn't offered in this picker —
// the CLI and ingest accept arbitrary values, and any existing value is
// preserved by prepending it below.
const SUBJECTS = ["Fysik", "Matematik", "Kemi", "AIPLA guides"];

/**
 * Materials section (1.1.25 M4). Mounted twice, switched by `mode`:
 * inside the activity builder (`"cite"`) and as the standalone
 * `/teacher/materials` library (`"library"`, 1.1.61).
 *
 * Affordances:
 *   - Browse the curriculum library (subject / folder / level / tag facets)
 *   - Organise a doc — subject, folder, tags (both modes; the library's point)
 *   - Cite a library doc → adds a MaterialRef to the activity (cite mode only)
 *   - Upload your own doc → ingests (teacher_owned), and cites it in cite mode
 *
 * The tutor's curriculum-retrieval tool (M3) is scoped to exactly these
 * cited docs — students never see the open corpus. Empty / loading / error
 * states are designed (Axiom 11).
 */
export function MaterialsSection({ materials, onChange, activityId, mode = "cite" }: Props) {
  const isLibrary = mode === "library";
  // Gates the "share to the shared library" upload option (curriculum-library.md
  // recommendation, enforced 2026-08-14): only researchers may add to the
  // institutional shared corpus, so an ordinary teacher never sees the checkbox.
  const isResearcher = useIsResearcher();
  const [docs, setDocs] = useState<CurriculumDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 1.1.60 — level is a chip row like the others, and can select the
  // "no level assigned" bucket where most teacher uploads actually live.
  const [levelFilter, setLevelFilter] = useState<LevelFilter | "">("");
  const [topicFilter, setTopicFilter] = useState("");
  // 1.1.59 — debounced search term (the input updates on every keystroke; the
  // browse only fires 250ms after typing settles) + pagination state.
  const [debouncedTopic, setDebouncedTopic] = useState("");
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // 1.1.60 — every facet's options + narrowed counts, from one endpoint.
  const [facets, setFacets] = useState<CurriculumFacets>({
    subjects: [],
    levels: [],
    folders: [],
    tags: [],
  });
  // 1.1.58 M1 — tags are the one AND-combinable facet. `editTagsFor` holds the
  // docId whose inline tag editor is open.
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [editTagsFor, setEditTagsFor] = useState<string | null>(null);
  // 1.1.58 M2 — subject facet (single-select).
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  // 1.1.58 M3 — folders. `selectedFolder`: "" = all, "__unfiled__" = unfiled, else a folder id.
  // `folders` is the raw folder list, kept alongside `facets.folders` because the
  // per-row "move to" dropdown and the delete confirmation need the TRUE doc
  // count, not the count narrowed by the current filter.
  const [folders, setFolders] = useState<CurriculumFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");

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
      subject: selectedSubject || undefined,
      folder: selectedFolder || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [levelFilter, debouncedTopic, selectedTags, selectedSubject, selectedFolder],
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

  // 1.1.60 — refetch the facets whenever the SELECTION changes, not just once:
  // the counts are narrowed by the other active facets, so they're only correct
  // relative to the current filter. Passing browseParams(0) keeps the two calls
  // in lockstep — the chips can never describe a different query than the list.
  const loadFacets = useCallback(async () => {
    try {
      const [next, folderList] = await Promise.all([
        listCurriculumFacets(browseParams(0)),
        listCurriculumFolders(),
      ]);
      setFacets(next);
      setFolders(folderList);
    } catch {
      // Facets are additive — a failure just means no chip row, never a blocker.
      setFacets({ subjects: [], levels: [], folders: [], tags: [] });
      setFolders([]);
    }
  }, [browseParams]);

  // 1.1.58 M4 — active-filter summary + one-shot reset. The search term uses the
  // live `topicFilter` (not the debounced copy) so the chip clears instantly.
  const hasActiveFilters = Boolean(
    levelFilter || topicFilter.trim() || selectedTags.length || selectedSubject || selectedFolder,
  );

  function clearAllFilters() {
    setLevelFilter("");
    setTopicFilter("");
    setSelectedTags([]);
    setSelectedSubject("");
    setSelectedFolder("");
  }

  function folderLabel(id: string): string {
    if (id === UNFILED) return "Unfiled";
    return (
      folders.find((f) => f.folderId === id)?.name ??
      facets.folders.find((f) => f.value === id)?.label ??
      "Folder"
    );
  }

  async function newFolder() {
    const name = window.prompt("New folder name")?.trim();
    if (!name) return;
    try {
      await createCurriculumFolder(name);
      void loadFacets();
    } catch {
      // Non-fatal.
    }
  }

  async function removeFolder(folderId: string) {
    // Confirm with the folder's TRUE doc count, not the count narrowed by the
    // current filter — "2 documents will be unfiled" must not undercount because
    // a subject chip happens to be selected.
    const f = folders.find((x) => x.folderId === folderId);
    const name = f?.name ?? folderLabel(folderId);
    const count = f?.docCount ?? 0;
    if (!window.confirm(`Delete folder “${name}”? Its ${count} document(s) will be unfiled, not deleted.`)) {
      return;
    }
    try {
      await deleteCurriculumFolder(folderId);
      if (selectedFolder === folderId) setSelectedFolder("");
      void loadFacets();
      void load(); // a filed doc may now be unfiled — refresh the list
    } catch {
      // Non-fatal.
    }
  }

  // M6 — delete a doc from the library. Mirrors the backend ACL: every doc a
  // teacher can browse (their own uploads + the shared corpus) is one they're
  // also allowed to delete, so no separate permission check is needed here —
  // deleting a shared doc removes it for every teacher, which the confirm spells out.
  async function removeDoc(doc: CurriculumDoc) {
    const scopeWarning =
      doc.source === "shared"
        ? "This is in the SHARED library — every teacher using it will lose access."
        : "This removes it from your library.";
    if (!window.confirm(`Delete “${doc.title}”? ${scopeWarning}`)) {
      return;
    }
    try {
      await deleteCurriculumDoc(doc.docId);
      setDocs((prev) => (prev ? prev.filter((d) => d.docId !== doc.docId) : prev));
      setTotal((t) => Math.max(0, t - 1));
      if (citedIds.has(doc.docId)) {
        onChange(materials.filter((m) => m.docId !== doc.docId));
      }
      if (viewDoc?.docId === doc.docId) {
        setViewDoc(null);
        setView(null);
      }
      void loadFacets();
    } catch {
      // Non-fatal: the row stays put and the teacher can retry.
    }
  }

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);

  function toggleTagFilter(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  // Persist a tag edit for one doc, then reflect it locally + refresh facets so a
  // brand-new tag becomes a filterable chip.
  async function applyTagEdit(
    docId: string,
    body: { addTags?: string[]; removeTags?: string[]; subject?: string | null; folderId?: string | null },
  ) {
    try {
      const updated = await patchCurriculumTags(docId, body);
      setDocs((prev) => (prev ? prev.map((d) => (d.docId === docId ? updated : d)) : prev));
      void loadFacets();
    } catch {
      // Non-fatal: the row keeps its prior facets; the teacher can retry.
    }
  }

  function toggleCite(doc: CurriculumDoc) {
    if (citedIds.has(doc.docId)) {
      onChange(materials.filter((m) => m.docId !== doc.docId));
    } else {
      // Default not student-visible (opt-in, 1.1.33 M2a) — the teacher reveals
      // it deliberately. Grounding uses it either way.
      onChange([...materials, { docId: doc.docId, origin: doc.origin, title: doc.title, studentVisible: false }]);
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
        {isLibrary ? (
          <>
            The shared document library. Upload documents, and file them by
            subject, folder and tag so they are findable when you build an
            activity. Every teacher sees — and can organise — the shared corpus.
          </>
        ) : (
          <>
            Cite curriculum documents so the tutor can ground its answers with a
            source. The tutor uses every cited document; students only see the
            ones you mark <span className="font-medium">visible</span>.
          </>
        )}
      </p>

      {/* Cited materials chips — each with a per-material student-visibility toggle (1.1.33 M2a).
          Library mode has no activity to cite INTO, so this block never renders there. */}
      {!isLibrary && materials.length > 0 ? (
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

      {/* Filters. 1.1.60 — search + upload here; every FACET is a chip row in the
          strip below, so Level no longer sits apart as a lone <select>. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
          Search materials
          <input
            type="text"
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
            placeholder="title, topic, tag…"
            aria-label="Search materials"
            className="rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <UploadButton
          activityId={activityId}
          isResearcher={isResearcher}
          // 1.1.60 — an upload inherits whatever you're currently filtered to, so
          // it lands categorised instead of Unfiled-and-subjectless. This is the
          // capture gap that left every doc with subject=null: the field existed
          // on the backend from 1.1.58 M2, but no upload path ever sent it.
          subject={selectedSubject || undefined}
          folderId={selectedFolder && selectedFolder !== UNFILED ? selectedFolder : undefined}
          folderLabel={selectedFolder && selectedFolder !== UNFILED ? folderLabel(selectedFolder) : undefined}
          onUploaded={(doc) => {
            // Add the new doc to the visible list + cite it immediately. Default
            // not student-visible (opt-in, 1.1.33 M2a) — same as toggleCite.
            setDocs((prev) => (prev ? [doc, ...prev] : [doc]));
            setTotal((t) => t + 1);
            // Library mode has no activity to cite into — the upload just joins
            // the corpus. Citing there would silently mutate a `materials` array
            // nobody is saving.
            if (!isLibrary) {
              onChange([...materials, { docId: doc.docId, origin: doc.origin, title: doc.title, studentVisible: false }]);
            }
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

      {/* 1.1.60 — the facet strip. Subject (broad class) → Folder (the taxonomy
          within it) → Level → Tags, all one chip idiom, all showing counts
          narrowed by the other active facets. */}
      <div className="flex flex-col gap-2 rounded border border-border/60 bg-muted/20 p-2.5">
        <FacetRow
          label="Subject"
          icon={<BookOpen className="h-3.5 w-3.5" aria-hidden="true" />}
          options={facets.subjects}
          selected={selectedSubject}
          onSelect={setSelectedSubject}
        />
        <FacetRow
          label="Folders"
          icon={<Folder className="h-3.5 w-3.5" aria-hidden="true" />}
          options={facets.folders}
          selected={selectedFolder}
          onSelect={setSelectedFolder}
          // Folders are the only user-created facet, so they carry a delete on
          // each chip (docs get unfiled, never deleted) and a New at the end.
          renderAction={(o) =>
            o.value === UNFILED ? null : (
              <button
                type="button"
                aria-label={`Delete folder ${o.label}`}
                onClick={() => void removeFolder(o.value)}
                className="hover:text-destructive"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )
          }
        >
          <button
            type="button"
            onClick={() => void newFolder()}
            className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
            New
          </button>
        </FacetRow>
        <FacetRow
          label="Level"
          options={facets.levels}
          selected={levelFilter}
          onSelect={(v) => setLevelFilter(v as LevelFilter | "")}
        />
        <FacetRow
          label="Tags"
          icon={<Tag className="h-3.5 w-3.5" aria-hidden="true" />}
          options={facets.tags}
          selected={selectedTags}
          onSelect={toggleTagFilter}
          multi
        />
      </div>

      {/* Active-filter chips (1.1.58 M4) — echo every applied filter, each
          removable, plus Clear all. Only shown when something is active. */}
      {hasActiveFilters ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          <span className="text-xs font-medium text-muted-foreground">Active</span>
          {levelFilter ? (
            <ActiveChip
              label={levelFilter === UNLEVELLED ? "No level" : `Level ${levelFilter}`}
              onRemove={() => setLevelFilter("")}
            />
          ) : null}
          {topicFilter.trim() ? (
            <ActiveChip label={`“${topicFilter.trim()}”`} onRemove={() => setTopicFilter("")} />
          ) : null}
          {selectedSubject ? (
            <ActiveChip label={selectedSubject} onRemove={() => setSelectedSubject("")} />
          ) : null}
          {selectedFolder ? (
            <ActiveChip label={folderLabel(selectedFolder)} onRemove={() => setSelectedFolder("")} />
          ) : null}
          {selectedTags.map((t) => (
            <ActiveChip
              key={t}
              label={`#${t}`}
              onRemove={() => setSelectedTags((prev) => prev.filter((x) => x !== t))}
            />
          ))}
          <button
            type="button"
            onClick={clearAllFilters}
            className="ml-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Clear all
          </button>
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
          hasActiveFilters ? (
            // No-match (filters active) — never a dead end: always a way back.
            <div className="flex flex-col items-start gap-2 p-4 text-sm text-muted-foreground">
              <span>No materials match your filters.</span>
              <button
                type="button"
                onClick={clearAllFilters}
                className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              No documents yet. Browse the shared A/B/C library or upload your own.
            </div>
          )
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
                      {doc.subject ? ` · ${doc.subject}` : ""}
                      {doc.topic ? ` · ${doc.topic}` : ""}
                    </span>
                    {doc.summary ? (
                      <span className="line-clamp-2 text-xs text-muted-foreground/80">{doc.summary}</span>
                    ) : null}
                    {/* Tags (1.1.58 M1) — chips with remove; an inline add editor.
                        Subject (1.1.58 M2) — a picker shown while editing. */}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {editTagsFor === doc.docId ? (
                        <select
                          value={doc.subject ?? ""}
                          aria-label={`Set subject for ${doc.title}`}
                          onChange={(e) => void applyTagEdit(doc.docId, { subject: e.target.value || null })}
                          className="rounded border border-border bg-background px-1 py-0.5 text-[11px]"
                        >
                          <option value="">No subject</option>
                          {(doc.subject && !SUBJECTS.includes(doc.subject) ? [doc.subject, ...SUBJECTS] : SUBJECTS).map(
                            (s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ),
                          )}
                        </select>
                      ) : null}
                      {/* Move to folder — only folders of the SAME scope are assignable. */}
                      {editTagsFor === doc.docId ? (
                        <select
                          value={doc.folderId ?? ""}
                          aria-label={`Set folder for ${doc.title}`}
                          onChange={(e) => void applyTagEdit(doc.docId, { folderId: e.target.value || null })}
                          className="rounded border border-border bg-background px-1 py-0.5 text-[11px]"
                        >
                          <option value="">No folder</option>
                          {folders
                            .filter((f) => f.ownerScope === doc.ownerScope)
                            .map((f) => (
                              <option key={f.folderId} value={f.folderId}>
                                {f.name}
                              </option>
                            ))}
                        </select>
                      ) : null}
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
                      {/* The editor behind this button covers subject, folder AND
                          tags. In the builder it stays labelled by tags (the
                          incidental edit you make while citing); in the library
                          filing IS the job, so it reads "Organise". */}
                      <button
                        type="button"
                        aria-label={
                          editTagsFor === doc.docId
                            ? isLibrary
                              ? `Done organising ${doc.title}`
                              : `Done editing tags for ${doc.title}`
                            : isLibrary
                              ? `Organise ${doc.title}`
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
                            {isLibrary ? "Organise" : doc.tags.length === 0 ? "Add tags" : "Edit"}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {/* Cite belongs to an activity. The library has none, so the
                        column is dropped rather than rendered inert. */}
                    {isLibrary ? null : (
                      <button
                        type="button"
                        onClick={() => toggleCite(doc)}
                        aria-pressed={cited}
                        aria-label={cited ? `Remove ${doc.title}` : `Cite ${doc.title}`}
                        className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition-colors ${
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
                    )}
                    <button
                      type="button"
                      aria-label={`Delete ${doc.title}`}
                      title="Delete from the library"
                      onClick={() => void removeDoc(doc)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
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
  isResearcher,
  subject,
  folderId,
  folderLabel,
  onUploaded,
  onImageUploaded,
}: {
  activityId?: string;
  /** Only researchers get the "share to the shared library" checkbox — the
   *  backend 403s a non-researcher's shared=true anyway, so this just keeps
   *  the control from appearing where it can't work. */
  isResearcher: boolean;
  /** 1.1.60 — metadata the upload inherits from the current filter selection. */
  subject?: string;
  folderId?: string;
  folderLabel?: string;
  onUploaded: (doc: CurriculumDoc) => void;
  onImageUploaded: (ref: MaterialRef) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Reset after every upload (success or failure) — sharing is a deliberate,
  // per-file choice, never a sticky default a researcher could forget is on.
  const [shareToLibrary, setShareToLibrary] = useState(false);

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
        // 1.1.60: inherit the current subject/folder selection.
        subject,
        folderId,
        shared: (isResearcher && shareToLibrary) || undefined,
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
      setShareToLibrary(false);
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
      {/* Researcher-only: mark the next upload as cleared for the shared
          library instead of your own private one. Backend-enforced (403 for
          anyone else) — this checkbox only ever appears where it will work. */}
      {isResearcher ? (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={shareToLibrary}
            onChange={(e) => setShareToLibrary(e.target.checked)}
          />
          Share to the shared library (asserts copyright clearance)
        </label>
      ) : null}
      {/* Say where it will land — inheriting the filter is only a good default if
          the teacher can see it happening. */}
      {subject || folderLabel ? (
        <span className="text-xs text-muted-foreground">
          Files into {[subject, folderLabel].filter(Boolean).join(" · ")}
        </span>
      ) : null}
      {err ? <span className="text-xs text-destructive">{err}</span> : null}
    </div>
  );
}
