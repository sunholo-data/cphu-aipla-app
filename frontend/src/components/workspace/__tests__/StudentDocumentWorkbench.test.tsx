import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const listMyDocuments = vi.fn();
const uploadDocument = vi.fn();
const deleteDocument = vi.fn();
vi.mock("@/lib/documentApi", () => ({
  listMyDocuments: (...a: unknown[]) => listMyDocuments(...a),
  uploadDocument: (...a: unknown[]) => uploadDocument(...a),
  deleteDocument: (...a: unknown[]) => deleteDocument(...a),
}));

// The viewer is lazy (next/dynamic) + drags in pdf.js — mock it; the workbench's
// job is to hand it the ACTIVE file, which we assert via its name.
vi.mock("../DocumentViewer", () => ({
  DocumentViewer: ({ files }: { files: { name: string }[] }) => (
    <div data-testid="viewer">{files[0]?.name}</div>
  ),
}));

import { StudentDocumentWorkbench } from "../StudentDocumentWorkbench";

const DOCS = [
  { docId: "d1", name: "opgave.pdf", sourceFormat: "pdf" },
  { docId: "d2", name: "noter.txt", sourceFormat: "txt" },
];

afterEach(() => vi.clearAllMocks());

describe("StudentDocumentWorkbench (1.1.45 M3b)", () => {
  it("lists the group's files and renders the first as active in the viewer", async () => {
    listMyDocuments.mockResolvedValue(DOCS);
    render(<StudentDocumentWorkbench skillId="phys-1" />);
    expect(await screen.findByTestId("viewer")).toHaveTextContent("opgave.pdf");
    expect(screen.getByRole("tablist", { name: "Dine filer" })).toBeInTheDocument();
    expect(listMyDocuments).toHaveBeenCalledWith("phys-1", "student");
  });

  it("switches the active file on tab click and reports it to the caller", async () => {
    listMyDocuments.mockResolvedValue(DOCS);
    const onActive = vi.fn();
    render(<StudentDocumentWorkbench skillId="s" onActiveDocChange={onActive} />);
    await screen.findByTestId("viewer");
    await waitFor(() => expect(onActive).toHaveBeenCalledWith("d1"));
    fireEvent.click(screen.getByRole("tab", { name: /noter\.txt/ }));
    expect(await screen.findByTestId("viewer")).toHaveTextContent("noter.txt");
    expect(onActive).toHaveBeenLastCalledWith("d2");
  });

  it("shows an empty state with an upload CTA when there are no files", async () => {
    listMyDocuments.mockResolvedValue([]);
    render(<StudentDocumentWorkbench skillId="s" />);
    expect(await screen.findByText(/ikke uploadet nogen filer/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Upload fil/ }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
  });

  it("uploads a picked file with the activity skillId and re-lists it active", async () => {
    listMyDocuments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ docId: "new1", name: "min-opgave.pdf", sourceFormat: "pdf" }]);
    uploadDocument.mockResolvedValue({ docId: "new1", name: "min-opgave.pdf" });
    const { container } = render(<StudentDocumentWorkbench skillId="phys-2" />);
    await screen.findByText(/ikke uploadet nogen filer/i);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "min-opgave.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByTestId("viewer")).toHaveTextContent("min-opgave.pdf");
    expect(uploadDocument).toHaveBeenCalledWith(file, "phys-2", "student");
  });

  it("deletes a file and re-lists, falling back to the remaining file", async () => {
    listMyDocuments.mockResolvedValueOnce(DOCS).mockResolvedValueOnce([DOCS[1]]);
    deleteDocument.mockResolvedValue(undefined);
    render(<StudentDocumentWorkbench skillId="s" />);
    await screen.findByTestId("viewer");
    fireEvent.click(screen.getByRole("button", { name: "Slet opgave.pdf" }));
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith("d1", "student"));
    expect(await screen.findByTestId("viewer")).toHaveTextContent("noter.txt");
  });

  it("shows an error state with a working retry when listing fails", async () => {
    listMyDocuments.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(DOCS);
    render(<StudentDocumentWorkbench skillId="s" />);
    const retry = await screen.findByRole("button", { name: "Prøv igen" });
    fireEvent.click(retry);
    expect(await screen.findByTestId("viewer")).toHaveTextContent("opgave.pdf");
  });

  it("keeps Upload available when listing fails — a list error must not block uploading", async () => {
    listMyDocuments.mockRejectedValue(new Error("boom"));
    render(<StudentDocumentWorkbench skillId="s" />);
    // The error banner renders, AND the upload toolbar is still present.
    await screen.findByRole("button", { name: "Prøv igen" });
    expect(screen.getByRole("button", { name: /Upload fil/ })).toBeInTheDocument();
  });

  it("surfaces an upload failure without losing the surface", async () => {
    listMyDocuments.mockResolvedValue([]);
    uploadDocument.mockRejectedValueOnce(new Error("nope"));
    const { container } = render(<StudentDocumentWorkbench skillId="s" />);
    await screen.findByText(/ikke uploadet nogen filer/i);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.pdf")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/Kunne ikke uploade/);
  });

  it("passes role=teacher through to the document API (builder preview)", async () => {
    listMyDocuments.mockResolvedValue([]);
    render(<StudentDocumentWorkbench skillId="s" role="teacher" />);
    await waitFor(() => expect(listMyDocuments).toHaveBeenCalledWith("s", "teacher"));
  });
});
