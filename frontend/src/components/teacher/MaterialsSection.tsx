"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  FileUp,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  X,
} from "lucide-react";

import {
  type CurriculumDoc,
  type CurriculumFacets,
  type CurriculumFolder,
  type DocContent,
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
import { ActiveChip, FacetRow } from "@/components/teacher/ui/FacetRow";
import { SpendDeniedNotice } from "@/components/teacher/SpendDeniedNotice";
import { RagStatusLine } from "@/components/teacher/RagStatusLine";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { LoadError } from "@/components/ui/load-error";
import { RowMenu, type RowMenuItem } from "@/components/ui/row-menu";
import { Spinner } from "@/components/ui/spinner";
import { notify } from "@/components/ui/toast";
import { useT } from "@/i18n";
import { isSpendDenied } from "@/lib/accessTier";

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
   *  `"cite"` (default) is the activity-builder mount: the activity's chosen
   *  documents come first, and "Tilføj dokument" opens the library picker
   *  (search, filters, upload) to choose more.
   *
   *  `"library"` is the standalone `/teacher/materials` mount: curate the
   *  corpus itself — subject, folder, tags, upload — with no activity in scope.
   *  Choosing is meaningless there, so there is no chosen list and the library
   *  is always open. */
  mode?: "cite" | "library";
  /** The editor already titles this block with its own section heading, so it
   *  passes `false` and the heading stays for screen readers only. */
  showHeading?: boolean;
}

// 1.1.59 — page size for the paginated browse (server caps at 200).
const PAGE_SIZE = 50;
// 1.1.58 M3 — sentinel folder filter → docs with no folder (mirrors backend).
const UNFILED = "__unfiled__";
// 1.1.60 — subject is the BROAD class (mirrors backend SUBJECTS in
// db/models/curriculum.py). It used to be the nine Danish stx *physics* areas,
// which left the maths corpus homeless and "AIPLA guides" posing as a physics
// area; those areas are now FOLDERS. Free entry isn't offered in this picker —
// the CLI and ingest accept arbitrary values, and any existing value is
// preserved by prepending it below.
const SUBJECTS = ["Fysik", "Matematik", "Kemi", "AIPLA guides"];

/** "PDF", "DOCX"… from a filename, or null when it carries no extension (a
 *  shared doc's origin is a provenance like "uvm.dk", not a file). */
function fileType(...names: (string | undefined)[]): string | null {
  for (const n of names) {
    const m = n?.match(/\.(pdf|txt|md|docx|pptx|xlsx|odt|odp|ods|epub|html?|csv)$/i);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/**
 * Materials section (1.1.25 M4; simplified in the 2026-11 UI sweep). Mounted
 * twice, switched by `mode`: inside the activity builder (`"cite"`) and as the
 * standalone `/teacher/materials` library (`"library"`, 1.1.61).
 *
 * Cite mode, as the teacher meets it:
 *   - the documents chosen for this activity, one row each, with ONE visible
 *     control ("Eleverne kan åbne den") and a ⋯ for the rarer ones (opens
 *     first, whole text vs look-up, what was extracted, remove);
 *   - "Tilføj dokument" opens the picker: search + the library + Upload, with
 *     subject/folder/level/tag filters behind one "Filtrér" button and each
 *     library row's organise/new-folder/delete behind its own ⋯.
 *
 * Nothing that used to be on screen was removed — it moved. The tutor's
 * curriculum-retrieval tool (M3) is scoped to exactly these chosen docs —
 * students never see the open corpus. Loading / failed / empty are kept apart
 * (a failed read is a LoadError, never an empty list).
 */
export function MaterialsSection({ materials, onChange, activityId, mode = "cite", showHeading = true }: Props) {
  const t = useT("MaterialsSection");
  const confirm = useConfirm();
  const isLibrary = mode === "library";
  const headingId = useId();
  const pickerId = useId();
  const filterPanelId = useId();
  // Gates the "share to the shared library" upload option (curriculum-library.md
  // recommendation, enforced 2026-08-14): only researchers may add to the
  // institutional shared corpus, so an ordinary teacher never sees the checkbox.
  const isResearcher = useIsResearcher();
  // The library is always open where curating it IS the job; in the builder it
  // opens on "Tilføj dokument", and nothing is fetched until it does.
  const [pickerOpen, setPickerOpen] = useState(isLibrary);
  // Filters are navigation in the library and an occasional narrowing in the
  // builder, so they start open only in the library.
  const [filtersOpen, setFiltersOpen] = useState(isLibrary);
  const [docs, setDocs] = useState<CurriculumDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ kind: "forbidden" | "failed" } | null>(null);
  // 1.1.60 — level is a chip row like the others, and can select the
  // "no level assigned" bucket where most teacher uploads actually live.
  const [levelFilter, setLevelFilter] = useState<LevelFilter | "">("");
  const [topicFilter, setTopicFilter] = useState("");
  // 1.1.59 — debounced search term (the input updates on every keystroke; the
  // browse only fires 250ms after typing settles) + pagination state.
  const [debouncedTopic, setDebouncedTopic] = useState("");
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  // 1.1.60 — every facet's options + narrowed counts, from one endpoint.
  const [facets, setFacets] = useState<CurriculumFacets>({
    subjects: [],
    levels: [],
    folders: [],
    tags: [],
  });
  const [facetsFailed, setFacetsFailed] = useState(false);
  // 1.1.58 M1 — tags are the one AND-combinable facet. `editTagsFor` holds the
  // docId whose inline organise editor is open.
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
    const timer = setTimeout(() => setDebouncedTopic(topicFilter.trim()), 250);
    return () => clearTimeout(timer);
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
    setLoadMoreFailed(false);
    try {
      const page = await browseCurriculum(browseParams(0));
      setDocs(page.docs);
      setTotal(page.total);
    } catch (e) {
      setError({ kind: e instanceof CurriculumApiError && e.status === 403 ? "forbidden" : "failed" });
      setDocs(null);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [browseParams]);

  useEffect(() => {
    if (pickerOpen) void load();
  }, [load, pickerOpen]);

  // Fetch the NEXT page and APPEND (never replace) — the large-list affordance.
  async function loadMore() {
    if (!docs) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await browseCurriculum(browseParams(docs.length));
      setDocs((prev) => (prev ? [...prev, ...page.docs] : page.docs));
      setTotal(page.total);
    } catch {
      // Keep what we already have, and say so — the button stays to retry.
      setLoadMoreFailed(true);
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
      setFacetsFailed(false);
    } catch {
      // Never a blocker for the list — but never an empty filter panel that
      // reads as "nothing to filter by" either: the panel shows a LoadError.
      setFacets({ subjects: [], levels: [], folders: [], tags: [] });
      setFolders([]);
      setFacetsFailed(true);
    }
  }, [browseParams]);

  useEffect(() => {
    if (pickerOpen) void loadFacets();
  }, [loadFacets, pickerOpen]);

  // 1.1.58 M4 — active-filter summary + one-shot reset. The search term uses the
  // live `topicFilter` (not the debounced copy) so the chip clears instantly.
  const hasActiveFilters = Boolean(
    levelFilter || topicFilter.trim() || selectedTags.length || selectedSubject || selectedFolder,
  );
  // What the "Filtrér" button counts: the facets hidden behind it (the search
  // box is always on screen, so it doesn't count).
  const facetCount =
    (levelFilter ? 1 : 0) + (selectedSubject ? 1 : 0) + (selectedFolder ? 1 : 0) + selectedTags.length;

  function clearAllFilters() {
    setLevelFilter("");
    setTopicFilter("");
    setSelectedTags([]);
    setSelectedSubject("");
    setSelectedFolder("");
  }

  function folderLabel(id: string): string {
    if (id === UNFILED) return t("unfiled");
    return (
      folders.find((f) => f.folderId === id)?.name ??
      facets.folders.find((f) => f.value === id)?.label ??
      t("folder")
    );
  }

  /** Create a folder (yours). With `fileDoc`, also put that document in it —
   *  offered only on your own documents, the only ones a personal folder can
   *  hold (a shared doc in a personal folder is a 400). */
  async function newFolder(fileDoc?: CurriculumDoc) {
    const name = window.prompt(t("newFolderPrompt"))?.trim();
    if (!name) return;
    try {
      const folder = await createCurriculumFolder(name);
      if (fileDoc && folder && folder.ownerScope === fileDoc.ownerScope) {
        await applyTagEdit(fileDoc.docId, { folderId: folder.folderId });
      } else {
        void loadFacets();
      }
    } catch {
      notify.error(t("actionFailed"));
    }
  }

  async function removeFolder(folderId: string) {
    // Confirm with the folder's TRUE doc count, not the count narrowed by the
    // current filter — "2 documents will be unfiled" must not undercount because
    // a subject chip happens to be selected.
    const f = folders.find((x) => x.folderId === folderId);
    const name = f?.name ?? folderLabel(folderId);
    const count = f?.docCount ?? 0;
    const ok = await confirm({
      title: t("deleteFolderConfirm", { name, count }),
      confirmLabel: t("deleteConfirmLabel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteCurriculumFolder(folderId);
      if (selectedFolder === folderId) setSelectedFolder("");
      void loadFacets();
      void load(); // a filed doc may now be unfiled — refresh the list
    } catch {
      notify.error(t("actionFailed"));
    }
  }

  // M6 — delete a doc from the library. Mirrors the backend ACL: every doc a
  // teacher can browse (their own uploads + the shared corpus) is one they're
  // also allowed to delete, so no separate permission check is needed here —
  // deleting a shared doc removes it for every teacher, which the confirm spells out.
  async function removeDoc(doc: CurriculumDoc) {
    const ok = await confirm({
      title: t("deleteDocConfirm", { title: doc.title }),
      description: doc.source === "shared" ? t("sharedWarning") : t("ownWarning"),
      confirmLabel: t("deleteConfirmLabel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteCurriculumDoc(doc.docId);
      setDocs((prev) => (prev ? prev.filter((d) => d.docId !== doc.docId) : prev));
      setTotal((n) => Math.max(0, n - 1));
      if (citedIds.has(doc.docId)) {
        onChange(materials.filter((m) => m.docId !== doc.docId));
      }
      if (viewDoc?.docId === doc.docId) {
        setViewDoc(null);
        setView(null);
      }
      void loadFacets();
    } catch {
      // The row stays put and the teacher can retry.
      notify.error(t("actionFailed"));
    }
  }

  function toggleTagFilter(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
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
      // The row keeps its prior facets; the teacher can retry.
      notify.error(t("actionFailed"));
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

  /** 1.1.87 — reference (RAG, the tutor CAN look it up) ⟷ context (inlined every
   *  turn, the tutor HAS it). The same document either way; only the mechanism
   *  changes. Reference stays the default because it is the cheaper one and the
   *  right one for a textbook — but a teacher who attaches the task their students
   *  are working on needs the other. The choice is deliberate, never automatic
   *  (decided in the 2026-11 sweep); it sits in the row's ⋯ and the row's meta
   *  line says when a document is read whole. */
  function toggleInContext(docId: string) {
    onChange(
      materials.map((m) =>
        m.docId === docId && m.kind !== "image"
          ? { ...m, kind: m.kind === "context" ? "curriculum" : "context" }
          : m,
      ),
    );
  }

  function toggleStudentVisible(m: MaterialRef) {
    onChange(
      materials.map((x) =>
        (m.kind === "image" ? x.kind === "image" && x.materialId === m.materialId : x.kind !== "image" && x.docId === m.docId)
          ? { ...x, studentVisible: !x.studentVisible }
          : x,
      ),
    );
  }

  /** 1.1.147 M3 — students land on the first shared document, in the order the
   *  materials were added. "Åbner først" moves this one to the front, and
   *  shares it: a document students cannot open cannot open first. */
  function makeOpenFirst(docId: string) {
    const target = materials.find((x) => x.kind !== "image" && x.docId === docId);
    if (!target) return;
    onChange([{ ...target, studentVisible: true }, ...materials.filter((x) => x !== target)]);
  }

  async function removeMaterial(m: MaterialRef) {
    if (m.kind === "image") {
      // An image's bytes are deleted with it — unlike a document, which stays
      // in the library and can be added again — so this one asks first.
      const ok = await confirm({
        title: t("removeImageConfirm", { label: m.alt || t("image") }),
        confirmLabel: t("removeConfirmLabel"),
        destructive: true,
      });
      if (!ok) return;
      if (activityId && m.materialId) {
        void deleteActivityImage(activityId, m.materialId).catch(() => {});
      }
      onChange(materials.filter((x) => !(x.kind === "image" && x.materialId === m.materialId)));
    } else {
      onChange(materials.filter((x) => x.docId !== m.docId));
    }
  }

  // 1.1.33 M4/M3 — "what we extracted" is per-document: open it from any
  // chosen or library doc to read exactly what was parsed from IT.
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
            ? t("noAccess")
            : t("docLoadFailed"),
      });
    }
  }

  // 1.1.147 M3 — the document students land on (DocumentsPanel opens the first
  // shared one, in the order the materials were added).
  const firstSharedDocId = materials.find((x) => x.kind !== "image" && x.studentVisible)?.docId;

  function chosenRow(m: MaterialRef) {
    const isImage = m.kind === "image";
    const label = isImage ? m.alt || t("image") : m.title || m.origin || m.docId;
    const visible = Boolean(m.studentVisible);
    const inContext = m.kind === "context";
    const opensFirst = !isImage && visible && m.docId === firstSharedDocId;
    const type = isImage ? t("image") : fileType(m.origin, m.title) ?? (m.origin && m.origin !== label ? m.origin : null);
    const meta = [
      type,
      opensFirst ? t("metaOpensFirst") : null,
      visible ? null : t("metaTutorOnly"),
      inContext ? t("metaFullText") : null,
    ].filter(Boolean);
    const Icon = isImage ? ImageIcon : FileText;
    const items: RowMenuItem[] = isImage
      ? []
      : [
          ...(opensFirst
            ? []
            : [{ id: "opens-first", label: t("makeOpenFirst"), hint: t("makeOpenFirstHint"), onSelect: () => makeOpenFirst(m.docId) }]),
          inContext
            ? { id: "reference", label: t("useAsReference"), hint: t("useAsReferenceHint"), onSelect: () => toggleInContext(m.docId) }
            : { id: "context", label: t("useInContext"), hint: t("useInContextHint"), onSelect: () => toggleInContext(m.docId) },
          { id: "view", label: t("viewExtracted"), onSelect: () => void openContent(m.docId, label) },
        ];
    items.push({ id: "remove", label: t("removeFromActivity"), onSelect: () => void removeMaterial(m), danger: true });
    return (
      <li
        key={isImage ? `img:${m.materialId}` : m.docId}
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm"
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{label}</span>
          {meta.length > 0 ? <span className="text-xs text-muted-foreground">{meta.join(" · ")}</span> : null}
        </div>
        {/* The one visible control. State in words: at the 10-05 seminar seven
            activities shared nothing and nothing on screen said so. */}
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={visible}
            onChange={() => toggleStudentVisible(m)}
            className="h-4 w-4 accent-primary"
          />
          {t("studentsCanOpen")}
        </label>
        <RowMenu label={t("rowMenu", { label })} items={items} />
      </li>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className={showHeading ? "flex flex-wrap items-center justify-between gap-2" : "flex flex-wrap items-center justify-end gap-2"}>
        <h3 id={headingId} className={showHeading ? "flex items-center gap-1.5 text-sm font-medium" : "sr-only"}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {t("legend")}
          {isLibrary ? null : (
            <>
              {" "}
              <span className="font-normal text-muted-foreground">· {t("legendHint")}</span>
            </>
          )}
        </h3>
        {isLibrary ? null : (
          <Button
            size="sm"
            aria-expanded={pickerOpen}
            aria-controls={pickerId}
            onClick={() => setPickerOpen((o) => !o)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("addDocument")}
          </Button>
        )}
      </div>
      {isLibrary ? <p className="text-xs text-muted-foreground">{t("libraryIntro")}</p> : null}

      {/* The activity's chosen documents, first. Library mode has no activity to
          choose INTO, so this block never renders there. */}
      {isLibrary ? null : materials.length > 0 ? (
        <ul aria-label={t("chosen")} className="divide-y divide-border rounded-md border border-border">
          {materials.map((m) => chosenRow(m))}
        </ul>
      ) : pickerOpen ? null : (
        <p className="text-sm text-muted-foreground">{t("noneChosen")}</p>
      )}

      {pickerOpen ? (
        <div
          id={pickerId}
          role={isLibrary ? undefined : "region"}
          aria-label={isLibrary ? undefined : t("pickerTitle")}
          className={isLibrary ? "flex flex-col gap-3" : "flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3"}
        >
          {isLibrary ? null : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{t("pickerTitle")}</p>
              <Button variant="ghost" size="sm" onClick={() => setPickerOpen(false)}>
                <Check className="h-4 w-4" aria-hidden="true" />
                {t("done")}
              </Button>
            </div>
          )}

          {/* Search + Filtrér. Every FACET sits behind Filtrér; the search box
              is the one always-visible way to narrow. */}
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                name="materials-search"
                autoComplete="off"
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("search")}
                className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm"
              />
            </div>
            <Button
              size="sm"
              aria-expanded={filtersOpen}
              aria-controls={filterPanelId}
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {facetCount > 0 ? t("filterCount", { count: facetCount }) : t("filter")}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${filtersOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </Button>
          </div>

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
              setTotal((n) => n + 1);
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

          {/* 1.1.60 — the facet strip, behind Filtrér. Subject (broad class) →
              Folder (the taxonomy within it) → Level → Tags, all one chip idiom,
              all showing counts narrowed by the other active facets. */}
          {filtersOpen ? (
            <div
              id={filterPanelId}
              className="flex flex-col gap-2 rounded-md border border-border/60 bg-background p-2.5"
            >
              {facetsFailed ? (
                <LoadError what={t("filtersWhat")} onRetry={() => void loadFacets()} />
              ) : null}
              <FacetRow
                label={t("subject")}
                icon={<BookOpen className="h-3.5 w-3.5" aria-hidden="true" />}
                options={facets.subjects}
                selected={selectedSubject}
                onSelect={setSelectedSubject}
              />
              <FacetRow
                label={t("folders")}
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
                      aria-label={t("deleteFolderAria", { label: o.label })}
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
                  {t("newFolder")}
                </button>
              </FacetRow>
              <FacetRow
                label={t("level")}
                options={facets.levels}
                selected={levelFilter}
                onSelect={(v) => setLevelFilter(v as LevelFilter | "")}
              />
              <FacetRow
                label={t("tags")}
                icon={<Tag className="h-3.5 w-3.5" aria-hidden="true" />}
                options={facets.tags}
                selected={selectedTags}
                onSelect={toggleTagFilter}
                multi
              />
            </div>
          ) : null}

          {/* Active-filter chips (1.1.58 M4) — echo every applied filter, each
              removable, plus Clear all, even while the panel is closed: a hidden
              filter must never silently shrink the list. */}
          {hasActiveFilters ? (
            <div className="flex flex-wrap items-center gap-1.5" aria-label={t("activeFilters")}>
              <span className="text-xs font-medium text-muted-foreground">{t("active")}</span>
              {levelFilter ? (
                <ActiveChip
                  label={levelFilter === UNLEVELLED ? t("noLevel") : t("levelChip", { level: levelFilter })}
                  onRemove={() => setLevelFilter("")}
                />
              ) : null}
              {topicFilter.trim() ? (
                <ActiveChip label={t("queryChip", { q: topicFilter.trim() })} onRemove={() => setTopicFilter("")} />
              ) : null}
              {selectedSubject ? (
                <ActiveChip label={selectedSubject} onRemove={() => setSelectedSubject("")} />
              ) : null}
              {selectedFolder ? (
                <ActiveChip label={folderLabel(selectedFolder)} onRemove={() => setSelectedFolder("")} />
              ) : null}
              {selectedTags.map((tag) => (
                <ActiveChip
                  key={tag}
                  label={t("tagChip", { tag })}
                  onRemove={() => setSelectedTags((prev) => prev.filter((x) => x !== tag))}
                />
              ))}
              <button
                type="button"
                onClick={clearAllFilters}
                className="ml-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
              >
                {t("clearAll")}
              </button>
            </div>
          ) : null}

          {/* Library list */}
          {loading ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background p-4 text-sm text-muted-foreground">
              <Spinner size="sm" />
              {t("loadingLibrary")}
            </div>
          ) : error?.kind === "forbidden" ? (
            <p role="alert" className="rounded-md border border-border bg-background p-4 text-sm text-destructive">
              {t("teacherOnly")}
            </p>
          ) : error ? (
            <LoadError what={t("libraryWhat")} onRetry={() => void load()} />
          ) : (
            <div className="rounded-md border border-border bg-background">
              {!docs || docs.length === 0 ? (
                hasActiveFilters ? (
                  // No-match (filters active) — never a dead end: always a way back.
                  <div className="flex flex-col items-start gap-2 p-4 text-sm text-muted-foreground">
                    <span>{t("noMatch")}</span>
                    <Button size="sm" onClick={clearAllFilters}>
                      {t("clearAllFilters")}
                    </Button>
                  </div>
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">{t("emptyLibrary")}</div>
                )
              ) : (
                <ul className="divide-y divide-border">
                  {docs.map((doc) => (
                    <LibraryRow
                      key={doc.docId}
                      doc={doc}
                      isLibrary={isLibrary}
                      cited={citedIds.has(doc.docId)}
                      editing={editTagsFor === doc.docId}
                      folders={folders}
                      canRetry={doc.ownerScope !== "shared" || isResearcher}
                      onToggleCite={() => toggleCite(doc)}
                      onView={() => void openContent(doc.docId, doc.title)}
                      onToggleEdit={() => setEditTagsFor((cur) => (cur === doc.docId ? null : doc.docId))}
                      onCloseEdit={() => setEditTagsFor(null)}
                      onNewFolder={() => void newFolder(doc)}
                      onDelete={() => void removeDoc(doc)}
                      onEdit={(body) => void applyTagEdit(doc.docId, body)}
                      onUpdated={(u) =>
                        setDocs((prev) => (prev ? prev.map((d) => (d.docId === u.docId ? u : d)) : prev))
                      }
                    />
                  ))}
                </ul>
              )}
              {/* 1.1.59 — large-list footer: honest count + load-more (never an
                  unbounded dump). Shown only once a page is loaded. */}
              {docs && docs.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-2 text-xs text-muted-foreground">
                  <span>{t("showing", { shown: docs.length, total })}</span>
                  {loadMoreFailed ? (
                    <span role="alert" className="text-destructive">
                      {t("loadMoreFailed")}
                    </span>
                  ) : null}
                  {docs.length < total ? (
                    <Button
                      size="sm"
                      onClick={() => void loadMore()}
                      pending={loadingMore}
                    >
                      {t("loadMore")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

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
                <span className="truncate">{t("extractedTitle", { title: viewDoc?.title ?? "" })}</span>
              </Dialog.Title>
              <Dialog.Close
                aria-label={t("close")}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-sm">
              {view?.kind === "loading" ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Spinner size="sm" />
                  {t("loading")}
                </p>
              ) : view?.kind === "error" ? (
                <p className="text-destructive">{view.message}</p>
              ) : view?.kind === "ready" && !view.content.available ? (
                <p className="text-muted-foreground">
                  {t("unavailable")}
                </p>
              ) : view?.kind === "ready" && !view.content.text.trim() ? (
                <p className="text-destructive">
                  {t("nothingExtracted")}
                </p>
              ) : view?.kind === "ready" ? (
                <>
                  <pre className="whitespace-pre-wrap font-sans leading-relaxed text-foreground">
                    {view.content.text}
                  </pre>
                  {view.content.text.length < view.content.chars ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("truncated", { shown: view.content.text.length, chars: view.content.chars })}
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

// -----------------------------------------------------------------------------
// One library document: title + meta, one visible action ("Brug i aktiviteten"
// in the builder), everything else in its ⋯. The organise editor (subject,
// folder, tags) opens inline under the row from that menu.
// -----------------------------------------------------------------------------

function LibraryRow({
  doc,
  isLibrary,
  cited,
  editing,
  folders,
  canRetry,
  onToggleCite,
  onView,
  onToggleEdit,
  onCloseEdit,
  onNewFolder,
  onDelete,
  onEdit,
  onUpdated,
}: {
  doc: CurriculumDoc;
  isLibrary: boolean;
  cited: boolean;
  editing: boolean;
  folders: CurriculumFolder[];
  canRetry: boolean;
  onToggleCite: () => void;
  onView: () => void;
  onToggleEdit: () => void;
  onCloseEdit: () => void;
  onNewFolder: () => void;
  onDelete: () => void;
  onEdit: (body: { addTags?: string[]; removeTags?: string[]; subject?: string | null; folderId?: string | null }) => void;
  onUpdated: (doc: CurriculumDoc) => void;
}) {
  const t = useT("MaterialsSection");
  const items: RowMenuItem[] = [
    { id: "view", label: t("viewExtracted"), onSelect: onView },
    { id: "organise", label: t("organise"), onSelect: onToggleEdit },
    // A personal folder can hold only your own documents.
    ...(doc.ownerScope !== "shared"
      ? [{ id: "new-folder", label: t("moveToNewFolder"), onSelect: onNewFolder }]
      : []),
    { id: "delete", label: t("deleteFromLibrary"), onSelect: onDelete, danger: true },
  ];
  return (
    <li className="flex items-start gap-3 p-3 text-sm">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{doc.title}</span>
        <span className="text-xs text-muted-foreground">
          {doc.origin}
          {doc.level ? t("levelMeta", { level: doc.level }) : ""}
          {doc.subject ? ` · ${doc.subject}` : ""}
          {doc.topic ? ` · ${doc.topic}` : ""}
        </span>
        {/* 1.1.151 F1c — can the tutor read it? Failed carries "Prøv igen". */}
        <RagStatusLine doc={doc} canRetry={canRetry} onUpdated={onUpdated} />
        {doc.summary ? (
          <span className="line-clamp-2 text-xs text-muted-foreground/80">{doc.summary}</span>
        ) : null}
        {/* Tags (1.1.58 M1) — chips; while organising each gets a remove, plus
            subject (M2) and folder (M3) pickers and an add-tag input. */}
        {doc.tags.length > 0 || editing ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {editing ? (
              <select
                value={doc.subject ?? ""}
                aria-label={t("setSubject", { title: doc.title })}
                onChange={(e) => onEdit({ subject: e.target.value || null })}
                className="rounded border border-border bg-background px-1 py-0.5 text-[11px]"
              >
                <option value="">{t("noSubject")}</option>
                {(doc.subject && !SUBJECTS.includes(doc.subject) ? [doc.subject, ...SUBJECTS] : SUBJECTS).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : null}
            {/* Move to folder — only folders of the SAME scope are assignable. */}
            {editing ? (
              <select
                value={doc.folderId ?? ""}
                aria-label={t("setFolder", { title: doc.title })}
                onChange={(e) => onEdit({ folderId: e.target.value || null })}
                className="rounded border border-border bg-background px-1 py-0.5 text-[11px]"
              >
                <option value="">{t("noFolder")}</option>
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
                {editing ? (
                  <button
                    type="button"
                    aria-label={t("removeTagFrom", { tag, title: doc.title })}
                    onClick={() => onEdit({ removeTags: [tag] })}
                    className="hover:text-foreground"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            ))}
            {editing ? (
              <>
                <input
                  type="text"
                  autoFocus
                  name="add-tag"
                  autoComplete="off"
                  placeholder={t("addTagPlaceholder")}
                  aria-label={t("addTagTo", { title: doc.title })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const val = e.currentTarget.value.trim();
                      if (val) onEdit({ addTags: [val] });
                      e.currentTarget.value = "";
                    } else if (e.key === "Escape") {
                      onCloseEdit();
                    }
                  }}
                  className="w-28 rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
                />
                <button
                  type="button"
                  aria-label={t("doneOrganising", { title: doc.title })}
                  onClick={onCloseEdit}
                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <Check className="h-3 w-3" aria-hidden="true" />
                  {t("done")}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Choosing belongs to an activity. The library has none, so the button
            is dropped rather than rendered inert. */}
        {isLibrary ? null : (
          <Button size="sm" variant={cited ? "ghost" : "secondary"} aria-pressed={cited} onClick={onToggleCite}>
            {cited ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {cited ? t("inActivity") : t("useInActivity")}
            <span className="sr-only">: {doc.title}</span>
          </Button>
        )}
        <RowMenu label={t("rowMenu", { label: doc.title })} items={items} />
      </div>
    </li>
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
  const t = useT("MaterialsSection");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 1.1.124 — the spend gate is not an ordinary error. It needs the account
  // named and a way out, so it renders as its own notice rather than red text.
  const [spendDenied, setSpendDenied] = useState<string | null>(null);
  // Reset after every upload (success or failure) — sharing is a deliberate,
  // per-file choice, never a sticky default a researcher could forget is on.
  const [shareToLibrary, setShareToLibrary] = useState(false);

  async function handleFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setBusy(true);
    setErr(null);
    setSpendDenied(null);
    try {
      // 1.1.44 — route by type: an image becomes a material the tutor SEES
      // (stored in the activity artifact slot); anything else is text-extracted
      // into the curriculum/RAG corpus.
      if (_IMAGE_EXT_RE.test(file.name)) {
        if (!activityId) {
          setErr(t("saveFirst"));
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
        setErr(e.message || t("unsupported"));
      } else if (
        (e instanceof CurriculumApiError || e instanceof ActivityImageApiError) &&
        isSpendDenied(e)
      ) {
        // 402 = the spend gate. Checked by status, never by message text —
        // that is the reason the backend does not overload 403.
        setSpendDenied(e.message || "");
      } else {
        setErr(e instanceof Error ? e.message : t("uploadFailed"));
      }
    } finally {
      setBusy(false);
      setShareToLibrary(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        size="sm"
        pending={busy}
        pendingLabel={t("uploading")}
        onClick={() => inputRef.current?.click()}
      >
        <FileUp className="h-4 w-4" aria-hidden="true" />
        {t("upload")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.txt,.md,.docx,.pptx,.xlsx,.odt,.odp,.ods,.epub,.html,.htm,.csv,.png,.jpg,.jpeg,.webp,.gif"
        onChange={handleFile}
        className="hidden"
        aria-label={t("uploadAria")}
      />
      {/* Researcher-only: mark the next upload as cleared for the shared
          library instead of your own private one. Checking it is a legal
          assertion (copyright is cleared), so the label says so. Backend-
          enforced (403 for anyone else) — it only ever appears where it works. */}
      {isResearcher ? (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={shareToLibrary}
            onChange={(e) => setShareToLibrary(e.target.checked)}
          />
          {t("share")}
        </label>
      ) : null}
      {/* Say where it will land — inheriting the filter is only a good default if
          the teacher can see it happening. */}
      {subject || folderLabel ? (
        <span className="text-xs text-muted-foreground">
          {t("filesInto", { where: [subject, folderLabel].filter(Boolean).join(" · ") })}
        </span>
      ) : null}
      {err ? <span role="alert" className="basis-full text-xs text-destructive">{err}</span> : null}
      {spendDenied !== null ? (
        <div className="basis-full">
          <SpendDeniedNotice message={spendDenied || undefined} />
        </div>
      ) : null}
    </div>
  );
}
