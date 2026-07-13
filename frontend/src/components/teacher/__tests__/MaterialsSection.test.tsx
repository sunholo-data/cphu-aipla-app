import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browseCurriculum = vi.fn();
const ingestCurriculum = vi.fn();
const fetchCurriculumContent = vi.fn();
const listCurriculumFacets = vi.fn();
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
    createdAt: "2026-06-12T00:00:00Z",
    updatedAt: "2026-06-12T00:00:00Z",
    ...overrides,
  };
}

// 1.1.59 — browseCurriculum now returns a page { docs, total, limit, offset }.
function page(docs: unknown[], total?: number) {
  return { docs, total: total ?? docs.length, limit: 50, offset: 0 };
}

// The facet endpoint fires on mount for every render; default it to empty so
// existing tests don't need to know about it (a real value is set per-test).
beforeEach(() => listCurriculumFacets.mockResolvedValue({ tags: [] }));
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
    expect(onChange).toHaveBeenCalledWith([
      { docId: "d1", origin: "uvm.dk", studentVisible: false },
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

  it("filtering by level re-queries with that level", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await waitFor(() => expect(browseCurriculum).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Filter by level"), {
      target: { value: "A" },
    });
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith({
        level: "A",
        topic: undefined,
        tags: undefined,
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("renders tag facet chips and clicking one re-queries with that tag (1.1.58 M1)", async () => {
    browseCurriculum.mockResolvedValue(page([]));
    listCurriculumFacets.mockResolvedValue({ tags: ["exam", "lab"] });
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    const labChip = await screen.findByRole("button", { name: "lab" });
    fireEvent.click(labChip);
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith({
        level: undefined,
        topic: undefined,
        tags: ["lab"],
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("shows no tag facet row when no docs carry tags", async () => {
    browseCurriculum.mockResolvedValue(page([makeDoc()]));
    listCurriculumFacets.mockResolvedValue({ tags: [] });
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await screen.findByText("Energi og arbejde");
    expect(screen.queryByLabelText("Filter by tag")).not.toBeInTheDocument();
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
        { docId: "up1", origin: "my-notes.txt", studentVisible: false },
      ]),
    );
    // M4/M3 — the viewer opens for THIS doc (per-document), fetching its content.
    expect(fetchCurriculumContent).toHaveBeenCalledWith("up1");
    await waitFor(() =>
      expect(screen.getByText(/what we extracted — my-notes/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Newton's second law/)).toBeInTheDocument();
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

    const input = screen.getByLabelText("Filter by topic");
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
});
