import { fireEvent, render as rtlRender, screen, waitFor, within, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { LocaleProvider } from "@/i18n";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish, so render inside an English locale (the teacher chose EN).
function EnglishUI({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}
const render = (ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: EnglishUI, ...options });

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

// 2026-11 UI sweep — the builder shows the CHOSEN documents first; the library
// (search, filters, upload) lives behind "Add document", and the rarer actions
// behind each row's ⋯. These helpers open each layer the way a teacher does.
async function openPicker() {
  fireEvent.click(await screen.findByRole("button", { name: /Add document/i }));
  return screen.findByRole("region", { name: /Pick from the library/i });
}

async function openFilters() {
  fireEvent.click(await screen.findByRole("button", { name: /^Filter/ }));
}

/** Open a row's ⋯ (by its accessible name) from the keyboard and pick an item. */
async function chooseFromMenu(menu: string | RegExp, item: string | RegExp, scope?: HTMLElement) {
  const q = scope ? within(scope) : screen;
  const trigger = await q.findByRole("button", { name: menu });
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(await screen.findByRole("menuitem", { name: item }));
}

/** The menu's items as their visible labels (first line only). */
async function menuLabels(menu: string | RegExp): Promise<string[]> {
  const trigger = await screen.findByRole("button", { name: menu });
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  const items = await screen.findAllByRole("menuitem");
  return items.map((i) => i.querySelector("span")?.textContent ?? "");
}

function chosenRows() {
  return within(screen.getByRole("list", { name: "Chosen for this activity" })).getAllByRole("listitem");
}

describe("MaterialsSection", () => {
  it("says what goes here, and fetches nothing until the picker opens", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    expect(screen.getByText(/No documents yet\. Add a textbook/i)).toBeInTheDocument();
    // The old 95-word intro is gone; the heading carries the one line.
    expect(screen.getByRole("heading", { name: /^Materials · texts the tutor can use$/i })).toBeInTheDocument();
    expect(browseCurriculum).not.toHaveBeenCalled();
    expect(listCurriculumFacets).not.toHaveBeenCalled();
    await openPicker();
    await waitFor(() => expect(browseCurriculum).toHaveBeenCalled());
  });

  it("renders the empty state when the library has no docs", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await waitFor(() =>
      expect(screen.getByText(/Browse the shared A\/B\/C library/i)).toBeInTheDocument(),
    );
  });

  it("a failed library read is a LoadError with Try again, never the empty state", async () => {
    browseCurriculum.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(page([makeDoc()]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The materials library could not be loaded");
    expect(screen.queryByText(/Browse the shared A\/B\/C library/i)).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Energi og arbejde")).toBeInTheDocument();
  });

  it("lists library docs with origin + level", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await waitFor(() => expect(screen.getByText("Energi og arbejde")).toBeInTheDocument());
    expect(screen.getByText(/uvm\.dk · Level B · mechanics/)).toBeInTheDocument();
  });

  it("shows a doc's catalogue summary when present (1.1.52)", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ summary: "Covers energy conservation for B-level." })]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    expect(await screen.findByText("Covers energy conservation for B-level.")).toBeInTheDocument();
  });

  it("'Use in activity' calls onChange with a MaterialRef (default not student-visible)", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    const onChange = vi.fn();
    render(<MaterialsSection materials={[]} onChange={onChange} />);
    await openPicker();
    fireEvent.click(await screen.findByRole("button", { name: /Use in activity: Energi og arbejde/i }));
    // 1.1.63 M1 — the TITLE is cached here alongside the origin. `origin` is
    // provenance ("uvm.dk"), and while it was the only label cached at citation
    // time the tutor had nothing but a domain to cite at students. This
    // assertion is the guard: an attach path that stops setting `title`
    // silently reverts the citation voice.
    expect(onChange).toHaveBeenCalledWith([
      { docId: "d1", origin: "uvm.dk", title: "Energi og arbejde", studentVisible: false },
    ]);
  });

  it("the 'Students can open it' checkbox flips studentVisible (1.1.33 M2a)", async () => {
    const onChange = vi.fn();
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "Haka Fysik", studentVisible: false }]}
        onChange={onChange}
      />,
    );
    const box = within(chosenRows()[0]).getByRole("checkbox", { name: "Students can open it" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith([
      { docId: "d1", origin: "Haka Fysik", studentVisible: true },
    ]);
  });

  // 1.1.147 M3 — at the 10-05 seminar seven activities shared nothing and
  // nothing on screen said so. The state is words on every row, and the
  // document students land on is marked.
  it("says in words whether students can open each material, and which opens first", async () => {
    render(
      <MaterialsSection
        materials={[
          { docId: "d1", origin: "Fysik C læreplan", studentVisible: false },
          { docId: "d2", origin: "Vejledning til Fysik C", studentVisible: true },
          { docId: "d3", origin: "Haka Fysik", studentVisible: true },
        ]}
        onChange={vi.fn()}
      />,
    );
    const rows = chosenRows();
    expect(rows[0]).toHaveTextContent("only the tutor uses it");
    expect(within(rows[0]).getByRole("checkbox", { name: "Students can open it" })).not.toBeChecked();
    expect(within(rows[1]).getByRole("checkbox", { name: "Students can open it" })).toBeChecked();
    expect(within(rows[2]).getByRole("checkbox", { name: "Students can open it" })).toBeChecked();
    expect(rows[1]).not.toHaveTextContent("only the tutor uses it");
    // The FIRST shared one, in the order added — not the first row.
    expect(rows[1]).toHaveTextContent("opens first for students");
    expect(rows[0]).not.toHaveTextContent("opens first for students");
    expect(rows[2]).not.toHaveTextContent("opens first for students");
  });

  it("a row's meta names the file type", async () => {
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "opgave-3.pdf", title: "Opgave 3", studentVisible: true }]}
        onChange={vi.fn()}
      />,
    );
    expect(chosenRows()[0]).toHaveTextContent("PDF");
  });

  it("'Open this first for students' moves it to the front and shares it", async () => {
    const onChange = vi.fn();
    render(
      <MaterialsSection
        materials={[
          { docId: "d1", origin: "Haka Fysik", studentVisible: true },
          { docId: "d2", origin: "Opgave", studentVisible: false },
        ]}
        onChange={onChange}
      />,
    );
    // The one that already opens first does not offer it.
    expect(await menuLabels("More actions for Haka Fysik")).not.toContain("Open this first for students");
    await userEvent.keyboard("{Escape}");
    await chooseFromMenu("More actions for Opgave", /Open this first for students/);
    expect(onChange).toHaveBeenCalledWith([
      { docId: "d2", origin: "Opgave", studentVisible: true },
      { docId: "d1", origin: "Haka Fysik", studentVisible: true },
    ]);
  });

  // 1.1.87 — reference ⟷ context. The half that makes the 21-August failure
  // impossible to repeat SILENTLY: before this, a teacher had no way to know
  // which mechanism their upload got, because there was only one and it was
  // invisible. The choice stays deliberate (never automatic, 2026-11 sweep).
  it("a cited material defaults to Reference (the cheaper mechanism)", async () => {
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "Haka Fysik" }]}
        onChange={() => {}}
      />,
    );
    expect(chosenRows()[0]).not.toHaveTextContent("the tutor reads the whole text");
    const labels = await menuLabels("More actions for Haka Fysik");
    expect(labels).toContain("Let the tutor read the whole text every time");
    expect(labels).not.toContain("Let the tutor look it up when relevant");
  });

  it("choosing 'read the whole text' sets kind=context (1.1.87)", async () => {
    const onChange = vi.fn();
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "Haka Fysik", studentVisible: false }]}
        onChange={onChange}
      />,
    );
    await chooseFromMenu("More actions for Haka Fysik", /Let the tutor read the whole text/);
    expect(onChange).toHaveBeenCalledWith([
      { docId: "d1", origin: "Haka Fysik", studentVisible: false, kind: "context" },
    ]);
  });

  it("flipping a context material back makes it a curriculum material again", async () => {
    const onChange = vi.fn();
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "Haka Fysik", kind: "context" }]}
        onChange={onChange}
      />,
    );
    expect(chosenRows()[0]).toHaveTextContent("the tutor reads the whole text");
    await chooseFromMenu("More actions for Haka Fysik", /Let the tutor look it up when relevant/);
    expect(onChange).toHaveBeenCalledWith([
      { docId: "d1", origin: "Haka Fysik", kind: "curriculum" },
    ]);
  });

  it("the context choice leaves image materials alone", async () => {
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
    await chooseFromMenu("More actions for Haka Fysik", /Let the tutor read the whole text/);
    const next = onChange.mock.calls[0][0];
    expect(next[0]).toEqual({ docId: "", origin: "", kind: "image", materialId: "img-1", alt: "diagram" });
    expect(next[1].kind).toBe("context");
  });

  it("an image row offers only what applies to an image", async () => {
    render(
      <MaterialsSection
        materials={[{ docId: "", origin: "", kind: "image", materialId: "img-1", alt: "diagram" }]}
        onChange={vi.fn()}
        activityId="act-1"
      />,
    );
    expect(await menuLabels("More actions for diagram")).toEqual(["Remove from this activity"]);
  });

  it("un-citing from the library row removes it", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    const cited: MaterialRef[] = [{ docId: "d1", origin: "uvm.dk" }];
    const onChange = vi.fn();
    render(<MaterialsSection materials={cited} onChange={onChange} />);
    await openPicker();
    const button = await screen.findByRole("button", { name: /Added: Energi og arbejde/i });
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("'Remove from this activity' in the row's ⋯ removes it", async () => {
    const onChange = vi.fn();
    render(<MaterialsSection materials={[{ docId: "d1", origin: "Haka Fysik" }]} onChange={onChange} />);
    await chooseFromMenu("More actions for Haka Fysik", /Remove from this activity/);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("shows chosen materials as rows", async () => {
    render(
      <MaterialsSection
        materials={[{ docId: "d1", origin: "Haka Fysik" }]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Chosen for this activity")).toHaveTextContent("Haka Fysik");
  });

  it("the filters sit behind one Filter button that counts what is active", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ levels: opts({ A: 3 }), tags: opts({ lab: 1 }) }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    expect(screen.queryByRole("button", { name: "A (3)" })).not.toBeInTheDocument();
    await openFilters();
    fireEvent.click(await screen.findByRole("button", { name: "A (3)" }));
    fireEvent.click(await screen.findByRole("button", { name: "lab (1)" }));
    expect(await screen.findByRole("button", { name: /^Filter · 2/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("facets that fail to load show a LoadError in the filter panel", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockRejectedValue(new Error("down"));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await openFilters();
    expect(await screen.findByText("The filters could not be loaded")).toBeInTheDocument();
  });

  it("filtering by level re-queries with that level (1.1.60: a chip, not a select)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ levels: opts({ A: 3, B: 1 }) }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await openFilters();
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
    await openPicker();
    await openFilters();
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
    await openPicker();
    await openFilters();
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
    await openPicker();
    await openFilters();
    await screen.findByText("Energi og arbejde");
    expect(screen.queryByLabelText("Filter by tags")).not.toBeInTheDocument();
  });

  it("renders subject facet chips and clicking one re-queries with that subject (1.1.58 M2)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ subjects: opts({ Fysik: 4, Matematik: 2 }) }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await openFilters();
    fireEvent.click(await screen.findByRole("button", { name: "Fysik (4)" }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "Fysik", offset: 0 })),
    );
  });

  it("refetches the facets when the selection changes, so counts stay narrowed (1.1.60)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ subjects: opts({ Fysik: 4, Matematik: 2 }) }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await openFilters();
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
    await openPicker();
    await openFilters();
    fireEvent.click(await screen.findByRole("button", { name: "Fysik (0)" }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "Fysik" })),
    );
  });

  it("shows a doc's subject in the row meta (1.1.58 M2)", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ subject: "Kvantefysik" })]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    expect(await screen.findByText(/· Kvantefysik/)).toBeInTheDocument();
  });

  it("a library row's ⋯ holds what was extracted, organise and delete", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    expect(await menuLabels("More actions for Energi og arbejde")).toEqual([
      "See what was extracted",
      "Organise (subject, folder, tags)",
      "Delete from the library…",
    ]);
  });

  it("setting a subject from Organise calls patchCurriculumTags with the subject", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ subject: null })]));
    patchCurriculumTags.mockResolvedValue(makeDoc({ subject: "Fysik" }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    // Open the row editor from the ⋯, then pick a subject.
    await chooseFromMenu("More actions for Energi og arbejde", /Organise/);
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
    await openPicker();
    await openFilters();
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
    await openPicker();
    await openFilters();
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
    await openPicker();
    await openFilters();
    fireEvent.click(await screen.findByRole("button", { name: /Delete folder Kapitel 4/i }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("5 document(s)"));
    confirmSpy.mockRestore();
  });

  it("cancelling the folder delete confirm does NOT call the API", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(facets({ folders: opts({ f1: 0 }, { f1: "Kapitel 4" }) }));
    listCurriculumFolders.mockResolvedValue([
      { folderId: "f1", name: "Kapitel 4", ownerScope: "shared", docCount: 0 },
    ]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await openFilters();
    fireEvent.click(await screen.findByRole("button", { name: /Delete folder Kapitel 4/i }));
    expect(deleteCurriculumFolder).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("'New folder' still lives on the folder row of the filters", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    createCurriculumFolder.mockResolvedValue({ folderId: "fNew", name: "Optik", ownerScope: "teacher-1", docCount: 0 });
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Optik");
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await openFilters();
    fireEvent.click(await screen.findByRole("button", { name: "New folder" }));
    await waitFor(() => expect(createCurriculumFolder).toHaveBeenCalledWith("Optik"));
    promptSpy.mockRestore();
  });

  it("'Put in a new folder' on your own doc creates the folder and files the doc", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ ownerScope: "teacher-1", source: "teacher_upload" })]));
    createCurriculumFolder.mockResolvedValue({ folderId: "fNew", name: "Optik", ownerScope: "teacher-1", docCount: 0 });
    patchCurriculumTags.mockResolvedValue(makeDoc({ ownerScope: "teacher-1", folderId: "fNew", folderName: "Optik" }));
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Optik");
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await chooseFromMenu("More actions for Energi og arbejde", /Put in a new folder/);
    await waitFor(() => expect(createCurriculumFolder).toHaveBeenCalledWith("Optik"));
    await waitFor(() => expect(patchCurriculumTags).toHaveBeenCalledWith("d1", { folderId: "fNew" }));
    promptSpy.mockRestore();
  });

  // --- M6: deleting a document ---

  it("deleting a doc (confirmed) calls deleteCurriculumDoc and removes it from the list", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ ownerScope: "teacher-1", source: "teacher_upload" })]));
    deleteCurriculumDoc.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await chooseFromMenu("More actions for Energi og arbejde", /Delete from the library/);
    await waitFor(() => expect(deleteCurriculumDoc).toHaveBeenCalledWith("d1"));
    await waitFor(() => expect(screen.queryByText("Energi og arbejde")).not.toBeInTheDocument());
    confirmSpy.mockRestore();
  });

  it("cancelling the delete confirm does NOT call the API or remove the row", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await chooseFromMenu("More actions for Energi og arbejde", /Delete from the library/);
    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteCurriculumDoc).not.toHaveBeenCalled();
    expect(screen.getByText("Energi og arbejde")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("the delete confirm warns when the doc is in the shared library", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ source: "shared" })]));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await chooseFromMenu("More actions for Energi og arbejde", /Delete from the library/);
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
    const picker = await openPicker();
    await screen.findByRole("button", { name: /Added: Energi og arbejde/ });
    await chooseFromMenu("More actions for Energi og arbejde", /Delete from the library/, picker);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
    confirmSpy.mockRestore();
  });

  it("deleting is available in library mode too (no 'Use in activity' there)", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    deleteCurriculumDoc.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MaterialsSection mode="library" materials={[]} onChange={() => {}} />);
    await chooseFromMenu("More actions for Energi og arbejde", /Delete from the library/);
    await waitFor(() => expect(deleteCurriculumDoc).toHaveBeenCalledWith("d1"));
    confirmSpy.mockRestore();
  });

  it("the Unfiled chip filters by the unfiled sentinel", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue(
      facets({ folders: opts({ __unfiled__: 4 }, { __unfiled__: "Unfiled" }) }),
    );
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await openFilters();
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
    await openPicker();
    await chooseFromMenu("More actions for Energi og arbejde", /Organise/);
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
    await openPicker();
    // Folders arrive with the facets; wait for them before opening the editor.
    await waitFor(() => expect(listCurriculumFolders).toHaveBeenCalled());
    await chooseFromMenu("More actions for Energi og arbejde", /Organise/);
    const select = screen.getByLabelText("Set folder for Energi og arbejde");
    expect(await within(select).findByRole("option", { name: "Mine" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Shared" })).not.toBeInTheDocument();
  });

  it("renders a doc's tags as chips on its row (1.1.58 M1)", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ tags: ["lab", "exam"] })]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await screen.findByText("Energi og arbejde");
    expect(screen.getByText("lab")).toBeInTheDocument();
    expect(screen.getByText("exam")).toBeInTheDocument();
  });

  it("adding a tag inline calls patchCurriculumTags and reflects the update", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc({ tags: [] })]));
    patchCurriculumTags.mockResolvedValue(makeDoc({ tags: ["mekanik"] }));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    // Open the inline editor for the row.
    await chooseFromMenu("More actions for Energi og arbejde", /Organise/);
    const input = screen.getByLabelText("Add a tag to Energi og arbejde");
    fireEvent.change(input, { target: { value: "mekanik" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(patchCurriculumTags).toHaveBeenCalledWith("d1", { addTags: ["mekanik"] }),
    );
    // Facets refresh after an edit so a new tag becomes filterable (mount + edit).
    await waitFor(() => expect(listCurriculumFacets.mock.calls.length).toBeGreaterThanOrEqual(2));
    // Done closes the editor.
    fireEvent.click(screen.getByRole("button", { name: "Done organising Energi og arbejde" }));
    expect(screen.queryByLabelText("Add a tag to Energi og arbejde")).not.toBeInTheDocument();
  });

  it("surfaces a teacher-only 403 error", async () => {
    browseCurriculum.mockRejectedValue(new CurriculumApiError("forbidden", 403));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
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
    await openPicker();
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
    await openPicker();
    await openFilters();

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
    await openPicker();
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
    await openPicker();
    expect(screen.queryByText(/Add to the shared library/i)).not.toBeInTheDocument();

    const file = new File(["x"], "n.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload document or image"), { target: { files: [file] } });
    await waitFor(() => expect(ingestCurriculum).toHaveBeenCalled());
    expect(ingestCurriculum.mock.calls[0][0]).toMatchObject({ shared: undefined });
  });

  it("a researcher can check share-to-library (a copyright assertion), and ingest is called with shared=true", async () => {
    researcherRef.current = true;
    browseCurriculum.mockResolvedValue(page([]));
    ingestCurriculum.mockResolvedValue({
      doc: makeDoc({ docId: "up5", origin: "n.txt", title: "n", source: "shared", ownerScope: "shared" }),
      parsedPreview: "",
      parsedChars: 0,
    });
    fetchCurriculumContent.mockResolvedValue({ docId: "up5", title: "n", available: true, text: "", chars: 0 });
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();

    // The label keeps the legal meaning: checking it asserts copyright clearance.
    fireEvent.click(await screen.findByLabelText(/Add to the shared library \(I confirm copyright is cleared\)/i));
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
    await openPicker();

    const checkbox = await screen.findByLabelText(/Add to the shared library/i);
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
    await openPicker();
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
    await openPicker();
    await waitFor(() => expect(browseCurriculum).toHaveBeenCalled());

    const file = new File(["png"], "diagram.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload document or image"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/Save the activity before adding an image/i)).toBeInTheDocument());
    expect(uploadActivityImage).not.toHaveBeenCalled();
  });

  it("renders an image material as a row, toggles it, and removes it via the API (1.1.44)", async () => {
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
    const row = chosenRows()[0];
    expect(row).toHaveTextContent("free-body diagram");
    expect(row).toHaveTextContent("Image");

    fireEvent.click(within(row).getByRole("checkbox", { name: "Students can open it" }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...imageMat, studentVisible: true }]);

    // The image's bytes go with it, so removing asks first — and No keeps it.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await chooseFromMenu("More actions for free-body diagram", /Remove from this activity/);
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Remove the image “free-body diagram”?"));
    expect(deleteActivityImage).not.toHaveBeenCalled();

    await chooseFromMenu("More actions for free-body diagram", /Remove from this activity/);
    await waitFor(() => expect(deleteActivityImage).toHaveBeenCalledWith("act-1", "img-1"));
    expect(onChange).toHaveBeenLastCalledWith([]);
    confirmSpy.mockRestore();
  });

  it("'See what was extracted' on a chosen material opens its content viewer", async () => {
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
    await chooseFromMenu("More actions for Haka Fysik", /See what was extracted/);
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
    await openPicker();
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

  it("a failed Load more says so and keeps what was loaded", async () => {
    browseCurriculum
      .mockResolvedValueOnce(page([makeDoc({ docId: "d1", title: "Doc 1" })], 2))
      .mockRejectedValueOnce(new Error("down"));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await screen.findByText("Doc 1");
    fireEvent.click(screen.getByRole("button", { name: /Load more/i }));
    expect(await screen.findByText(/Couldn't load more/)).toBeInTheDocument();
    expect(screen.getByText("Doc 1")).toBeInTheDocument();
  });

  it("debounces the search input — rapid typing coalesces to one browse with the final value", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    await waitFor(() => expect(browseCurriculum).toHaveBeenCalled()); // first load

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
    await openPicker();
    await openFilters();
    fireEvent.click(await screen.findByRole("button", { name: "A (1)" }));
    // Closing the panel must not hide that a filter is narrowing the list.
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));

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
    await openPicker();
    await openFilters();
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
    await openPicker();
    await screen.findByText("Energi og arbejde");
    await openFilters();
    fireEvent.click(await screen.findByRole("button", { name: "A (1)" }));
    expect(await screen.findByText(/No materials match your filters/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear all filters/i }));
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith(expect.objectContaining({ level: undefined })),
    );
  });

  it("Done closes the picker", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("region", { name: /Pick from the library/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add document/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("speaks Danish by default", async () => {
    rtlRender(
      <MaterialsSection materials={[{ docId: "d1", origin: "Haka Fysik" }]} onChange={() => {}} />,
    );
    expect(screen.getByRole("heading", { name: /^Materialer · tekster tutoren kan bruge$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tilføj dokument/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Eleverne kan åbne den" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Valgt til aktiviteten" })).toHaveTextContent("kun tutoren bruger den");
  });

  // 1.1.61 — library mode: the standalone /teacher/materials mount. Curating the
  // corpus, not citing into an activity.
  describe("library mode", () => {
    it("is open from the start, drops 'Use in activity', and keeps the organise editor", async () => {
      browseCurriculum.mockResolvedValue(page([makeDoc()]));
      render(<MaterialsSection mode="library" materials={[]} onChange={() => {}} />);
      await screen.findByText("Energi og arbejde");
      expect(screen.queryByRole("button", { name: /Add document/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Use in activity/i })).not.toBeInTheDocument();
      expect(await menuLabels("More actions for Energi og arbejde")).toContain("Organise (subject, folder, tags)");
    });

    it("files a doc into a folder — the edit the library exists to make", async () => {
      const doc = makeDoc();
      browseCurriculum.mockResolvedValue(page([doc]));
      listCurriculumFolders.mockResolvedValue([
        { folderId: "f-mek", name: "Mekanik", ownerScope: "shared", createdAt: "2026-07-30T00:00:00Z", docCount: 0 },
      ]);
      patchCurriculumTags.mockResolvedValue({ ...doc, folderId: "f-mek", folderName: "Mekanik" });
      render(<MaterialsSection mode="library" materials={[]} onChange={() => {}} />);
      await waitFor(() => expect(listCurriculumFolders).toHaveBeenCalled());
      await chooseFromMenu("More actions for Energi og arbejde", /Organise/);
      const select = await screen.findByLabelText(/Set folder for Energi og arbejde/i);
      await within(select).findByRole("option", { name: "Mekanik" });
      fireEvent.change(select, { target: { value: "f-mek" } });
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
