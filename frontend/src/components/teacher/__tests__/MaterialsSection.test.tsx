import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browseCurriculum = vi.fn();
const ingestCurriculum = vi.fn();
const fetchCurriculumContent = vi.fn();
const listCurriculumFacets = vi.fn();
const listCurriculumFolders = vi.fn();
const createCurriculumFolder = vi.fn();
const deleteCurriculumFolder = vi.fn();
const deleteCurriculumDoc = vi.fn();
const patchCurriculumTags = vi.fn();
const uploadActivityImage = vi.fn();
const deleteActivityImage = vi.fn();

vi.mock("@/lib/curriculumApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/curriculumApi")>(
    "@/lib/curriculumApi",
  );
  return {
    ...actual,
    browseCurriculum: (...a: unknown[]) => browseCurriculum(...a),
    ingestCurriculum: (...a: unknown[]) => ingestCurriculum(...a),
    fetchCurriculumContent: (...a: unknown[]) => fetchCurriculumContent(...a),
    listCurriculumFacets: (...a: unknown[]) => listCurriculumFacets(...a),
    listCurriculumFolders: (...a: unknown[]) => listCurriculumFolders(...a),
    createCurriculumFolder: (...a: unknown[]) => createCurriculumFolder(...a),
    deleteCurriculumFolder: (...a: unknown[]) => deleteCurriculumFolder(...a),
    deleteCurriculumDoc: (...a: unknown[]) => deleteCurriculumDoc(...a),
    patchCurriculumTags: (...a: unknown[]) => patchCurriculumTags(...a),
  };
});

vi.mock("@/lib/activityImageApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/activityImageApi")>(
    "@/lib/activityImageApi",
  );
  return {
    ...actual,
    uploadActivityImage: (...a: unknown[]) => uploadActivityImage(...a),
    deleteActivityImage: (...a: unknown[]) => deleteActivityImage(...a),
  };
});

// Controllable researcher claim — drives the "share to shared library" upload option.
const { researcherRef } = vi.hoisted(() => ({ researcherRef: { current: false } }));
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => researcherRef.current }));

import { CurriculumApiError } from "@/lib/curriculumApi";
import { MaterialsSection } from "../MaterialsSection";
import type { MaterialRef } from "@/lib/teacherApi";

function makeDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    docId: "d1",
    title: "Energi og arbejde",
    level: "B",
    topic: "mechanics",
    source: "shared",
    ownerScope: "shared",
    origin: "uvm.dk",
    docArtifactId: "rag/1",
    copyrightStatus: "cleared",
    tags: [],
    subject: null,
    folderId: null,
    folderName: null,
    createdAt: "2026-06-12T00:00:00Z",
    updatedAt: "2026-06-12T00:00:00Z",
    ...overrides,
  };
}

// 1.1.59 — browseCurriculum now returns a page { docs, total, limit, offset }.
function page(docs: unknown[], total?: number) {
  return { docs, total: total ?? docs.length, limit: 50, offset: 0 };
}

/** 1.1.60 — facet options are {value, label, count}. Build them from a terse
 *  `{value: count}` map so the tests stay readable. `labels` overrides the
 *  display label for the sentinel buckets and for folders (whose value is an id). */
function opts(counts: Record<string, number>, labels: Record<string, string> = {}) {
  return Object.entries(counts).map(([value, count]) => ({
    value,
    label: labels[value] ?? value,
    count,
  }));
}

/** A full facets payload; every key defaults to empty. */
function facets(partial: Partial<Record<"subjects" | "levels" | "folders" | "tags", unknown[]>> = {}) {
  return { subjects: [], levels: [], folders: [], tags: [], ...partial };
}

// The facet endpoint fires on mount for every render; default it to empty so
// existing tests don't need to know about it (a real value is set per-test).
beforeEach(() => {
  listCurriculumFacets.mockResolvedValue(facets());
  listCurriculumFolders.mockResolvedValue([]);
  researcherRef.current = false;
});
afterEach(() => vi.clearAllMocks());

describe("MaterialsSection", () => {
  it("renders the empty state when the library has no docs", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/Browse the shared A\/B\/C library/i)).toBeInTheDocument(),
    );
  });

  it("lists library docs with origin + level", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("Energi og arbejde")).toBeInTheDocument());
    expect(screen.getByText(/uvm\.dk · Level B · mechanics/)).toBeInTheDocument();
  });

  it("shows a doc's catalogue summary when present (1.1.52)", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ summary: "Covers energy conservation for B-level." })]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    expect(await screen.findByText("Covers energy conservation for B-level.")).toBeInTheDocument();
  });

  it("citing a doc calls onChange with a MaterialRef (default not student-visible)", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    const onChange = vi.fn();
    render(<MaterialsSection materials={[]} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: /Cite Energi og arbejde/i }));
    // 1.1.63 M1 — the TITLE is cached here alongside the origin. `origin` is
    // provenance ("uvm.dk"), and while it was the only label cached at citation
    // time the tutor had nothing but a domain to cite at students. This
    // assertion is the guard: an attach path that stops setting `title`
    // silently reverts the citation voice.
    expect(onChange).toHaveBeenCalledWith([
      { docId: "d1", origin: "uvm.dk", title: "Energi og arbejde", studentVisible: false },
    ]);
  });

  it("toggling a cited material flips studentVisible (1.1.33 M2a)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    const onChange = vi.fn();
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "Haka Fysik", studentVisible: false }]}
        onChange={onChange}
      />,
    );
    // Hidden by default → the toggle offers to "Show … to students".
    fireEvent.click(
      await screen.findByRole("button", { name: /Show Haka Fysik to students/i }),
    );
    expect(onChange).toHaveBeenCalledWith([
      { docId: "d1", origin: "Haka Fysik", studentVisible: true },
    ]);
  });

  // 1.1.87 — reference ⟷ context. The half that makes the 21-August failure
  // impossible to repeat SILENTLY: before this, a teacher had no way to know
  // which mechanism their upload got, because there was only one and it was
  // invisible.
  it("a cited material defaults to Reference (the cheaper mechanism)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "Haka Fysik" }]}
        onChange={() => {}}
      />,
    );
    const chips = await screen.findByLabelText("Cited materials");
    expect(chips).toHaveTextContent("Reference");
    expect(chips).not.toHaveTextContent("In context");
  });

  it("flipping a material to In context sets kind=context (1.1.87)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    const onChange = vi.fn();
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "Haka Fysik", studentVisible: false }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Always give Haka Fysik to the tutor/i }),
    );
    expect(onChange).toHaveBeenCalledWith([
      { docId: "d1", origin: "Haka Fysik", studentVisible: false, kind: "context" },
    ]);
  });

  it("flipping a context material back makes it a curriculum material again", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    const onChange = vi.fn();
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "Haka Fysik", kind: "context" }]}
        onChange={onChange}
      />,
    );
    const chips = await screen.findByLabelText("Cited materials");
    expect(chips).toHaveTextContent("In context");
    fireEvent.click(
      await screen.findByRole("button", { name: /Stop always giving Haka Fysik to the tutor/i }),
    );
    expect(onChange).toHaveBeenCalledWith([
      { docId: "d1", origin: "Haka Fysik", kind: "curriculum" },
    ]);
  });

  it("the context toggle leaves image materials alone", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    const onChange = vi.fn();
    render(
      <MaterialsSection
        materials={[
          { docId: "", origin: "", kind: "image", materialId: "img-1", alt: "diagram" },
          { docId: "d1", origin: "Haka Fysik" },
        ]}
        onChange={onChange}
        activityId="act-1"
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Always give Haka Fysik to the tutor/i }),
    );
    const next = onChange.mock.calls[0][0];
    expect(next[0]).toEqual({ docId: "", origin: "", kind: "image", materialId: "img-1", alt: "diagram" });
    expect(next[1].kind).toBe("context");
  });

  it("un-citing an already-cited doc removes it", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    const cited: MaterialRef[] = [{ docId: "d1", origin: "uvm.dk" }];
    const onChange = vi.fn();
    render(<MaterialsSection materials={cited} onChange={onChange} />);
    // The list row shows "Cited"; clicking removes it.
    fireEvent.click(await screen.findByRole("button", { name: /Remove Energi og arbejde/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("shows cited materials as chips", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "Haka Fysik" }]}
        onChange={() => {}}
      />,
    );
    const chips = await screen.findByLabelText("Cited materials");
    expect(chips).toHaveTextContent("Haka Fysik");
  });

  it("filtering by level re-queries with that level (1.1.60: a chip, not a select)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ levels: opts({ A: 3, B: 1 }) }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "A (3)" }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith({
        level: "A",
        topic: undefined,
        tags: undefined,
        subject: undefined,
        folder: undefined,
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("the 'No level' chip filters by the unlevelled sentinel (1.1.60)", async () => {
    // Level is optional and no upload path sets it, so this bucket holds most
    // teacher uploads — it has to be reachable, not just a gap in the rail.
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(
      facets({ levels: opts({ A: 1, __unlevelled__: 7 }, { __unlevelled__: "No level" }) }),
    );
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "No level (7)" }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: "__unlevelled__", offset: 0 }),
      ),
    );
  });

  it("renders tag facet chips and clicking one re-queries with that tag (1.1.58 M1)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ tags: opts({ exam: 2, lab: 1 }) }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "lab (1)" }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith({
        level: undefined,
        topic: undefined,
        tags: ["lab"],
        subject: undefined,
        folder: undefined,
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("shows no tag facet row when no docs carry tags", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    listCurriculumFacets.mockResolvedValue(facets());
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await screen.findByText("Energi og arbejde");
    expect(screen.queryByLabelText("Filter by tags")).not.toBeInTheDocument();
  });

  it("renders subject facet chips and clicking one re-queries with that subject (1.1.58 M2)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ subjects: opts({ Fysik: 4, Matematik: 2 }) }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fysik (4)" }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "Fysik", offset: 0 })),
    );
  });

  it("refetches the facets when the selection changes, so counts stay narrowed (1.1.60)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ subjects: opts({ Fysik: 4, Matematik: 2 }) }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Matematik (2)" }));
    // The facets call carries the SAME filter as the browse — otherwise the chips
    // would describe a different query than the list below them.
    await waitFor(() =>
      expect(listCurriculumFacets).toHaveBeenLastCalledWith(
        expect.objectContaining({ subject: "Matematik" }),
      ),
    );
  });

  it("keeps zero-count options clickable rather than hiding them (1.1.60)", async () => {
    // Options come from the whole corpus, counts from the narrowed set — so the
    // rail never reshuffles mid-filter.
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ subjects: opts({ Fysik: 0, Matematik: 2 }) }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fysik (0)" }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "Fysik" })),
    );
  });

  it("shows a doc's subject in the row meta (1.1.58 M2)", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ subject: "Kvantefysik" })]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    expect(await screen.findByText(/· Kvantefysik/)).toBeInTheDocument();
  });

  it("setting a subject inline calls patchCurriculumTags with the subject", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ subject: null })]));
    patchCurriculumTags.mockResolvedValue(makeDoc({ subject: "Fysik" }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    // Open the row editor, then pick a subject.
    fireEvent.click(await screen.findByRole("button", { name: /Add tags for Energi og arbejde/i }));
    fireEvent.change(screen.getByLabelText("Set subject for Energi og arbejde"), {
      target: { value: "Fysik" },
    });
    await waitFor(() =>
      expect(patchCurriculumTags).toHaveBeenCalledWith("d1", { subject: "Fysik" }),
    );
  });

  // --- 1.1.58 M3: folders ---

  it("renders folder rail chips and filtering by a folder re-queries with its id", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ folders: opts({ f1: 3 }, { f1: "Kapitel 4" }) }));
    listCurriculumFolders.mockResolvedValue([
      { folderId: "f1", name: "Kapitel 4", ownerScope: "shared", docCount: 3 },
    ]);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Kapitel 4 \(3\)/ }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(expect.objectContaining({ folder: "f1", offset: 0 })),
    );
  });

  it("deleting a folder (confirmed) calls deleteCurriculumFolder and refreshes", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ folders: opts({ f1: 2 }, { f1: "Kapitel 4" }) }));
    listCurriculumFolders.mockResolvedValue([
      { folderId: "f1", name: "Kapitel 4", ownerScope: "shared", docCount: 2 },
    ]);
    deleteCurriculumFolder.mockResolvedValue({ deleted: "f1", unfiled: 2 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Delete folder Kapitel 4/i }));
    await waitFor(() => expect(deleteCurriculumFolder).toHaveBeenCalledWith("f1"));
    confirmSpy.mockRestore();
  });

  it("the delete confirm quotes the folder's TRUE count, not the narrowed one (1.1.60)", async () => {
    // The chip shows the count under the current filter; the confirmation must
    // not undercount what's about to be unfiled just because a chip is selected.
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ folders: opts({ f1: 1 }, { f1: "Kapitel 4" }) }));
    listCurriculumFolders.mockResolvedValue([
      { folderId: "f1", name: "Kapitel 4", ownerScope: "shared", docCount: 5 },
    ]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Delete folder Kapitel 4/i }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("5 document(s)"));
    confirmSpy.mockRestore();
  });

  it("cancelling the delete confirm does NOT call the API", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ folders: opts({ f1: 0 }, { f1: "Kapitel 4" }) }));
    listCurriculumFolders.mockResolvedValue([
      { folderId: "f1", name: "Kapitel 4", ownerScope: "shared", docCount: 0 },
    ]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Delete folder Kapitel 4/i }));
    expect(deleteCurriculumFolder).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // --- M6: deleting a document ---

  it("deleting a doc (confirmed) calls deleteCurriculumDoc and removes it from the list", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ ownerScope: "teacher-1", source: "teacher_upload" })]));
    deleteCurriculumDoc.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Energi og arbejde" }));
    await waitFor(() => expect(deleteCurriculumDoc).toHaveBeenCalledWith("d1"));
    await waitFor(() => expect(screen.queryByText("Energi og arbejde")).not.toBeInTheDocument());
    confirmSpy.mockRestore();
  });

  it("cancelling the delete confirm does NOT call the API or remove the row", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Energi og arbejde" }));
    expect(deleteCurriculumDoc).not.toHaveBeenCalled();
    expect(screen.getByText("Energi og arbejde")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("the delete confirm warns when the doc is in the shared library", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ source: "shared" })]));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Energi og arbejde" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("SHARED library"));
    confirmSpy.mockRestore();
  });

  it("deleting a cited doc also un-cites it", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    deleteCurriculumDoc.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onChange = vi.fn();
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "uvm.dk", title: "Energi og arbejde" }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete Energi og arbejde" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
    confirmSpy.mockRestore();
  });

  it("deleting is available in library mode too (no Cite column there)", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    deleteCurriculumDoc.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MaterialsSection mode="library" materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Energi og arbejde" }));
    await waitFor(() => expect(deleteCurriculumDoc).toHaveBeenCalledWith("d1"));
    confirmSpy.mockRestore();
  });

  it("the Unfiled chip filters by the unfiled sentinel", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(
      facets({ folders: opts({ __unfiled__: 4 }, { __unfiled__: "Unfiled" }) }),
    );
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unfiled (4)" }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(expect.objectContaining({ folder: "__unfiled__" })),
    );
  });

  it("moving a doc to a folder (same scope) calls patchCurriculumTags with folderId", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ ownerScope: "shared", folderId: null })]));
    listCurriculumFolders.mockResolvedValue([
      { folderId: "f1", name: "Kapitel 4", ownerScope: "shared", docCount: 0 },
    ]);
    patchCurriculumTags.mockResolvedValue(makeDoc({ folderId: "f1", folderName: "Kapitel 4" }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add tags for Energi og arbejde/i }));
    fireEvent.change(screen.getByLabelText("Set folder for Energi og arbejde"), {
      target: { value: "f1" },
    });
    await waitFor(() =>
      expect(patchCurriculumTags).toHaveBeenCalledWith("d1", { folderId: "f1" }),
    );
  });

  it("only offers same-scope folders in the move-to-folder picker", async () => {
    // A teacher-owned doc must not be able to pick a SHARED folder (assign would 400).
    browseCurriculum.mockResolvedValue(page([makeDoc({ ownerScope: "teacher-1", folderId: null })]));
    listCurriculumFolders.mockResolvedValue([
      { folderId: "fMine", name: "Mine", ownerScope: "teacher-1", docCount: 0 },
      { folderId: "fShared", name: "Shared", ownerScope: "shared", docCount: 0 },
    ]);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add tags for Energi og arbejde/i }));
    const select = screen.getByLabelText("Set folder for Energi og arbejde");
    expect(within(select).getByRole("option", { name: "Mine" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Shared" })).not.toBeInTheDocument();
  });

  it("renders a doc's tags as chips on its row (1.1.58 M1)", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ tags: ["lab", "exam"] })]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await screen.findByText("Energi og arbejde");
    expect(screen.getByText("lab")).toBeInTheDocument();
    expect(screen.getByText("exam")).toBeInTheDocument();
  });

  it("adding a tag inline calls patchCurriculumTags and reflects the update", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ tags: [] })]));
    patchCurriculumTags.mockResolvedValue(makeDoc({ tags: ["mekanik"] }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    // Open the inline editor for the row.
    fireEvent.click(await screen.findByRole("button", { name: /Add tags for Energi og arbejde/i }));
    const input = screen.getByLabelText("Add a tag to Energi og arbejde");
    fireEvent.change(input, { target: { value: "mekanik" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(patchCurriculumTags).toHaveBeenCalledWith("d1", { addTags: ["mekanik"] }),
    );
    // Facets refresh after an edit so a new tag becomes filterable (mount + edit).
    await waitFor(() => expect(listCurriculumFacets.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("surfaces a teacher-only 403 error", async () => {
    browseCurriculum.mockRejectedValue(new CurriculumApiError("forbidden", 403));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/teacher-only/i)).toBeInTheDocument(),
    );
  });

  it("uploading ingests, cites the new doc, and opens its parse viewer (per-document)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    ingestCurriculum.mockResolvedValue({
      doc: makeDoc({ docId: "up1", origin: "my-notes.txt", title: "my-notes" }),
      parsedPreview: "Newton's second law: F = m a.",
      parsedChars: 29,
    });
    fetchCurriculumContent.mockResolvedValue({
      docId: "up1",
      title: "my-notes",
      available: true,
      text: "Newton's second law: F = m a.",
      chars: 29,
    });
    const onChange = vi.fn();
    render(<MaterialsSection materials={[]} onChange={onChange} />);
    await waitFor(() => expect(browseCurriculum).toHaveBeenCalled());

    const file = new File(["content"], "my-notes.txt", { type: "text/plain" });
    const input = screen.getByLabelText("Upload document or image") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(ingestCurriculum).toHaveBeenCalled());
    expect(uploadActivityImage).not.toHaveBeenCalled();
    // 1.1.33: uploads are level-less — ingest is called WITHOUT a level.
    expect(ingestCurriculum.mock.calls[0][0]).not.toHaveProperty("level");
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        // 1.1.63 M1 — an uploaded doc caches its title too. Note origin here is
        // the FILENAME (uploads set origin = file.name), which is the clearest
        // case for why the tutor must cite by title: "According to
        // my-notes.txt" is not a source a student can act on.
        { docId: "up1", origin: "my-notes.txt", title: "my-notes", studentVisible: false },
      ]),
    );
    // M4/M3 — the viewer opens for THIS doc (per-document), fetching its content.
    expect(fetchCurriculumContent).toHaveBeenCalledWith("up1");
    await waitFor(() =>
      expect(screen.getByText(/what we extracted — my-notes/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Newton's second law/)).toBeInTheDocument();
  });

  it("an upload inherits the selected subject + folder (1.1.60 capture gap)", async () => {
    // THE regression guard for this milestone. The backend accepted `subject` at
    // ingest from 1.1.58 M2, but the upload form never sent it — so every doc
    // uploaded through the UI landed with subject=null and the Subject facet row
    // was empty for two weeks. If this assertion is ever relaxed, that returns.
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(
      facets({ subjects: opts({ Matematik: 2 }), folders: opts({ f1: 1 }, { f1: "Algebra" }) }),
    );
    listCurriculumFolders.mockResolvedValue([
      { folderId: "f1", name: "Algebra", ownerScope: "shared", docCount: 1 },
    ]);
    ingestCurriculum.mockResolvedValue({
      doc: makeDoc({ docId: "up2", origin: "opgaver.txt", title: "opgaver" }),
      parsedPreview: "",
      parsedChars: 0,
    });
    fetchCurriculumContent.mockResolvedValue({
      docId: "up2",
      title: "opgaver",
      available: true,
      text: "",
      chars: 0,
    });
    render(<MaterialsSection materials={[]} onChange={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Matematik (2)" }));
    fireEvent.click(await screen.findByRole("button", { name: /Algebra \(1\)/ }));
    // The teacher is told where it will land before they pick a file.
    expect(await screen.findByText(/Files into Matematik · Algebra/)).toBeInTheDocument();

    const file = new File(["x"], "opgaver.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload document or image"), { target: { files: [file] } });

    await waitFor(() =>
      expect(ingestCurriculum).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "Matematik", folderId: "f1" }),
      ),
    );
  });

  it("an upload with no filter selected sends no subject/folder (both stay optional)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    ingestCurriculum.mockResolvedValue({
      doc: makeDoc({ docId: "up3", origin: "n.txt", title: "n" }),
      parsedPreview: "",
      parsedChars: 0,
    });
    fetchCurriculumContent.mockResolvedValue({ docId: "up3", title: "n", available: true, text: "", chars: 0 });
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await waitFor(() => expect(browseCurriculum).toHaveBeenCalled());

    const file = new File(["x"], "n.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload document or image"), { target: { files: [file] } });

    await waitFor(() => expect(ingestCurriculum).toHaveBeenCalled());
    expect(ingestCurriculum.mock.calls[0][0]).toMatchObject({ subject: undefined, folderId: undefined });
    expect(screen.queryByText(/Files into/)).not.toBeInTheDocument();
  });

  // --- share-to-library upload option (researcher-only) ---

  it("a non-researcher never sees the share-to-library checkbox, and shared is never sent", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    ingestCurriculum.mockResolvedValue({
      doc: makeDoc({ docId: "up4", origin: "n.txt", title: "n" }),
      parsedPreview: "",
      parsedChars: 0,
    });
    fetchCurriculumContent.mockResolvedValue({ docId: "up4", title: "n", available: true, text: "", chars: 0 });
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    expect(screen.queryByText(/Share to the shared library/i)).not.toBeInTheDocument();

    const file = new File(["x"], "n.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload document or image"), { target: { files: [file] } });
    await waitFor(() => expect(ingestCurriculum).toHaveBeenCalled());
    expect(ingestCurriculum.mock.calls[0][0]).toMatchObject({ shared: undefined });
  });

  it("a researcher can check share-to-library, and ingest is called with shared=true", async () => {
    researcherRef.current = true;
    browseCurriculum.mockResolvedValue(page([]));
    ingestCurriculum.mockResolvedValue({
      doc: makeDoc({ docId: "up5", origin: "n.txt", title: "n", source: "shared", ownerScope: "shared" }),
      parsedPreview: "",
      parsedChars: 0,
    });
    fetchCurriculumContent.mockResolvedValue({ docId: "up5", title: "n", available: true, text: "", chars: 0 });
    render(<MaterialsSection materials={[]} onChange={() => {}} />);

    fireEvent.click(await screen.findByLabelText(/Share to the shared library/i));
    const file = new File(["x"], "n.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload document or image"), { target: { files: [file] } });

    await waitFor(() =>
      expect(ingestCurriculum).toHaveBeenCalledWith(expect.objectContaining({ shared: true })),
    );
  });

  it("the share checkbox resets after an upload, so sharing is per-file not sticky", async () => {
    researcherRef.current = true;
    browseCurriculum.mockResolvedValue(page([]));
    ingestCurriculum.mockResolvedValue({
      doc: makeDoc({ docId: "up6", origin: "n.txt", title: "n" }),
      parsedPreview: "",
      parsedChars: 0,
    });
    fetchCurriculumContent.mockResolvedValue({ docId: "up6", title: "n", available: true, text: "", chars: 0 });
    render(<MaterialsSection materials={[]} onChange={() => {}} />);

    const checkbox = await screen.findByLabelText(/Share to the shared library/i);
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    const file = new File(["x"], "n.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload document or image"), { target: { files: [file] } });
    await waitFor(() => expect(ingestCurriculum).toHaveBeenCalled());
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it("uploading an image routes to the activity-image endpoint (not curriculum ingest) and cites it (1.1.44)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    uploadActivityImage.mockResolvedValue({
      kind: "image",
      docId: "",
      origin: "",
      materialId: "img-1",
      mimeType: "image/png",
      alt: "free-body",
      studentVisible: false,
    });
    const onChange = vi.fn();
    render(<MaterialsSection materials={[]} onChange={onChange} activityId="act-1" />);
    await waitFor(() => expect(browseCurriculum).toHaveBeenCalled());

    const file = new File(["png"], "free-body.png", { type: "image/png" });
    const input = screen.getByLabelText("Upload document or image") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(uploadActivityImage).toHaveBeenCalledWith("act-1", file, "free-body"));
    expect(ingestCurriculum).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ kind: "image", materialId: "img-1", mimeType: "image/png" }),
      ]),
    );
  });

  it("blocks image upload when there is no activityId yet", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await waitFor(() => expect(browseCurriculum).toHaveBeenCalled());

    const file = new File(["png"], "diagram.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload document or image"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/Save the activity before adding an image/i)).toBeInTheDocument());
    expect(uploadActivityImage).not.toHaveBeenCalled();
  });

  it("renders an image material as a chip and removes it via the API (1.1.44)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    deleteActivityImage.mockResolvedValue(undefined);
    const onChange = vi.fn();
    const imageMat: MaterialRef = {
      kind: "image",
      docId: "",
      origin: "",
      materialId: "img-1",
      mimeType: "image/png",
      alt: "free-body diagram",
      studentVisible: false,
    };
    render(<MaterialsSection materials={[imageMat]} onChange={onChange} activityId="act-1" />);
    const chips = await screen.findByLabelText("Cited materials");
    expect(chips).toHaveTextContent("free-body diagram");

    fireEvent.click(screen.getByRole("button", { name: /Remove free-body diagram/i }));
    expect(deleteActivityImage).toHaveBeenCalledWith("act-1", "img-1");
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("clicking a cited material opens its content viewer", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    fetchCurriculumContent.mockResolvedValue({
      docId: "d1",
      title: "Haka Fysik",
      available: true,
      text: "Energi bevares.",
      chars: 15,
    });
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "Haka Fysik", studentVisible: true }]}
        onChange={() => {}}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Haka Fysik" }));
    expect(fetchCurriculumContent).toHaveBeenCalledWith("d1");
    await waitFor(() => expect(screen.getByText(/Energi bevares/)).toBeInTheDocument());
  });

  // --- 1.1.59: pagination + debounce ---

  it("shows 'Showing X of Y' and a Load more that appends the next page", async () => {
    const first = [makeDoc({ docId: "d1", title: "Doc 1" })];
    const second = [makeDoc({ docId: "d2", title: "Doc 2" })];
    // Mount page (total 2, one shown) then the next page on Load more.
    browseCurriculum.mockResolvedValueOnce(page(first, 2)).mockResolvedValueOnce(page(second, 2));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await screen.findByText("Doc 1");
    expect(screen.getByText("Showing 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Load more/i }));
    // Second page appended (not replaced).
    await screen.findByText("Doc 2");
    expect(screen.getByText("Doc 1")).toBeInTheDocument();
    // The second browse asked for offset = current length (1).
    expect(browseCurriculum).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 1, limit: 50 }),
    );
    // Fully loaded → no Load more, count updated.
    await waitFor(() => expect(screen.getByText("Showing 2 of 2")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Load more/i })).not.toBeInTheDocument();
  });

  it("debounces the search input — rapid typing coalesces to one browse with the final value", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await waitFor(() => expect(browseCurriculum).toHaveBeenCalled()); // mount load

    const input = screen.getByLabelText("Search materials");
    // Two rapid keystrokes within the 250ms window — the intermediate "at" timer
    // is cleared, so only the final value should ever reach a browse.
    fireEvent.change(input, { target: { value: "at" } });
    fireEvent.change(input, { target: { value: "atom" } });

    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(expect.objectContaining({ topic: "atom", offset: 0 })),
    );
    // Exactly one browse ever carried a topic, and it was never the intermediate "at".
    const topicCalls = browseCurriculum.mock.calls.filter(([p]) => Boolean(p?.topic));
    expect(topicCalls).toHaveLength(1);
    expect(browseCurriculum).not.toHaveBeenCalledWith(expect.objectContaining({ topic: "at" }));
  });

  // --- 1.1.58 M4: UX unify (active-filter chips, Clear all, no-match) ---

  it("shows an active-filter chip for a selected level and removing it re-queries", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ levels: opts({ A: 1 }) }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "A (1)" }));

    const active = await screen.findByLabelText("Active filters");
    expect(within(active).getByText("Level A")).toBeInTheDocument();
    // Removing the chip clears the level → browse re-queries without it.
    fireEvent.click(within(active).getByRole("button", { name: /Remove filter Level A/i }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(expect.objectContaining({ level: undefined })),
    );
  });

  it("Clear all resets every active filter", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(
      facets({ tags: opts({ lab: 1 }), subjects: opts({ Fysik: 1 }), levels: opts({ B: 1 }) }),
    );
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "B (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "lab (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Fysik (1)" }));
    // Clear all → next browse has no facets.
    fireEvent.click(await screen.findByRole("button", { name: "Clear all" }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: undefined, tags: undefined, subject: undefined }),
      ),
    );
    expect(screen.queryByLabelText("Active filters")).not.toBeInTheDocument();
  });

  it("no-match state offers Clear all when filters are active (never a dead end)", async () => {
    // First load (no filter) returns a doc; after filtering, empty.
    browseCurriculum.mockResolvedValueOnce(page([makeDoc()])).mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ levels: opts({ A: 1 }) }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await screen.findByText("Energi og arbejde");
    fireEvent.click(await screen.findByRole("button", { name: "A (1)" }));
    expect(await screen.findByText(/No materials match your filters/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear all filters/i }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(expect.objectContaining({ level: undefined })),
    );
  });

  // 1.1.61 — library mode: the standalone /teacher/materials mount. Curating the
  // corpus, not citing into an activity.
  describe("library mode", () => {
    it("drops Cite (there is no activity to cite into) but keeps the organise editor", async () => {
      browseCurriculum.mockResolvedValue(page([makeDoc()]));
      render(<MaterialsSection mode="library" materials={[]} onChange={() => {}} />);
      await screen.findByText("Energi og arbejde");
      expect(screen.queryByRole("button", { name: /Cite Energi og arbejde/i })).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Organise Energi og arbejde/i }),
      ).toBeInTheDocument();
    });

    it("files a doc into a folder — the edit the library exists to make", async () => {
      const doc = makeDoc();
      browseCurriculum.mockResolvedValue(page([doc]));
      listCurriculumFolders.mockResolvedValue([
        { folderId: "f-mek", name: "Mekanik", ownerScope: "shared", createdAt: "2026-07-30T00:00:00Z", docCount: 0 },
      ]);
      patchCurriculumTags.mockResolvedValue({ ...doc, folderId: "f-mek", folderName: "Mekanik" });
      render(<MaterialsSection mode="library" materials={[]} onChange={() => {}} />);
      fireEvent.click(await screen.findByRole("button", { name: /Organise Energi og arbejde/i }));
      fireEvent.change(await screen.findByLabelText(/Set folder for Energi og arbejde/i), {
        target: { value: "f-mek" },
      });
      await waitFor(() =>
        expect(patchCurriculumTags).toHaveBeenCalledWith("d1", { folderId: "f-mek" }),
      );
    });

    it("an upload joins the corpus without citing it", async () => {
      browseCurriculum.mockResolvedValue(page([]));
      ingestCurriculum.mockResolvedValue({
        doc: makeDoc({ docId: "up-lib", origin: "nyt.txt", title: "Nyt dokument" }),
      });
      fetchCurriculumContent.mockResolvedValue({
        docId: "up-lib",
        title: "Nyt dokument",
        available: true,
        text: "x",
        chars: 1,
      });
      const onChange = vi.fn();
      render(<MaterialsSection mode="library" materials={[]} onChange={onChange} />);
      await waitFor(() => expect(browseCurriculum).toHaveBeenCalled());

      const file = new File(["x"], "nyt.txt", { type: "text/plain" });
      fireEvent.change(screen.getByLabelText("Upload document or image"), { target: { files: [file] } });

      await waitFor(() => expect(ingestCurriculum).toHaveBeenCalled());
      // The doc lands in the list and its extraction opens — but nothing is
      // cited, because there is no activity here to cite into.
      expect(await screen.findByText("Nyt dokument")).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
