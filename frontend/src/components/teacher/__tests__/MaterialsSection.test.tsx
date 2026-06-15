import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const browseCurriculum = vi.fn();
const ingestCurriculum = vi.fn();

vi.mock("@/lib/curriculumApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/curriculumApi")>(
    "@/lib/curriculumApi",
  );
  return {
    ...actual,
    browseCurriculum: (...a: unknown[]) => browseCurriculum(...a),
    ingestCurriculum: (...a: unknown[]) => ingestCurriculum(...a),
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
    createdAt: "2026-06-12T00:00:00Z",
    updatedAt: "2026-06-12T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("MaterialsSection", () => {
  it("renders the empty state when the library has no docs", async () => {
    browseCurriculum.mockResolvedValue([]);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/Browse the shared A\/B\/C library/i)).toBeInTheDocument(),
    );
  });

  it("lists library docs with origin + level", async () => {
    browseCurriculum.mockResolvedValue([makeDoc()]);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("Energi og arbejde")).toBeInTheDocument());
    expect(screen.getByText(/uvm\.dk · Level B · mechanics/)).toBeInTheDocument();
  });

  it("citing a doc calls onChange with a MaterialRef (default not student-visible)", async () => {
    browseCurriculum.mockResolvedValue([makeDoc()]);
    const onChange = vi.fn();
    render(<MaterialsSection materials={[]} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: /Cite Energi og arbejde/i }));
    expect(onChange).toHaveBeenCalledWith([
      { docId: "d1", origin: "uvm.dk", studentVisible: false },
    ]);
  });

  it("toggling a cited material flips studentVisible (1.1.33 M2a)", async () => {
    browseCurriculum.mockResolvedValue([]);
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
    browseCurriculum.mockResolvedValue([makeDoc()]);
    const cited: MaterialRef[] = [{ docId: "d1", origin: "uvm.dk" }];
    const onChange = vi.fn();
    render(<MaterialsSection materials={cited} onChange={onChange} />);
    // The list row shows "Cited"; clicking removes it.
    fireEvent.click(await screen.findByRole("button", { name: /Remove Energi og arbejde/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("shows cited materials as chips", async () => {
    browseCurriculum.mockResolvedValue([]);
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
    browseCurriculum.mockResolvedValue([]);
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await waitFor(() => expect(browseCurriculum).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Filter by level"), {
      target: { value: "A" },
    });
    await waitFor(() =>
      expect(browseCurriculum).toHaveBeenLastCalledWith({ level: "A", topic: undefined }),
    );
  });

  it("surfaces a teacher-only 403 error", async () => {
    browseCurriculum.mockRejectedValue(new CurriculumApiError("forbidden", 403));
    render(<MaterialsSection materials={[]} onChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/teacher-only/i)).toBeInTheDocument(),
    );
  });

  it("uploading ingests then cites the new doc", async () => {
    browseCurriculum.mockResolvedValue([]);
    ingestCurriculum.mockResolvedValue(makeDoc({ docId: "up1", origin: "my-notes.txt" }));
    const onChange = vi.fn();
    render(<MaterialsSection materials={[]} onChange={onChange} />);
    await waitFor(() => expect(browseCurriculum).toHaveBeenCalled());

    const file = new File(["content"], "my-notes.txt", { type: "text/plain" });
    const input = screen.getByLabelText("Upload curriculum document") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(ingestCurriculum).toHaveBeenCalled());
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([{ docId: "up1", origin: "my-notes.txt" }]),
    );
  });
});
