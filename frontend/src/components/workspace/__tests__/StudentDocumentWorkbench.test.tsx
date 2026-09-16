import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const listMyDocuments = vi.fn();
const uploadDocument = vi.fn();
const deleteDocument = vi.fn();
const resizeImageFile = vi.fn();
vi.mock("@/lib/imageResize", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imageResize")>("@/lib/imageResize");
  return { ...actual, resizeImageFile: (...a: unknown[]) => resizeImageFile(...a) };
});

vi.mock("@/lib/documentApi", async () => {
  // Keep the real DocumentApiError class — the component does `instanceof`
  // checks on it to pick the right error message.
  const actual = await vi.importActual<typeof import("@/lib/documentApi")>("@/lib/documentApi");
  return {
    ...actual,
    listMyDocuments: (...a: unknown[]) => listMyDocuments(...a),
    uploadDocument: (...a: unknown[]) => uploadDocument(...a),
    deleteDocument: (...a: unknown[]) => deleteDocument(...a),
  };
});

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
    expect(await screen.findByText(/ikke uploadet noget endnu/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Upload fil eller billede/ }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
  });

  it("uploads a picked file with the activity skillId and re-lists it active", async () => {
    listMyDocuments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ docId: "new1", name: "min-opgave.pdf", sourceFormat: "pdf" }]);
    uploadDocument.mockResolvedValue({ docId: "new1", name: "min-opgave.pdf", status: "parsed" });
    const { container } = render(<StudentDocumentWorkbench skillId="phys-2" />);
    await screen.findByText(/ikke uploadet noget endnu/i);
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
    expect(screen.getByRole("button", { name: /Upload fil eller billede/ })).toBeInTheDocument();
  });

  it("surfaces an upload failure without losing the surface", async () => {
    listMyDocuments.mockResolvedValue([]);
    uploadDocument.mockRejectedValueOnce(new Error("nope"));
    const { container } = render(<StudentDocumentWorkbench skillId="s" />);
    await screen.findByText(/ikke uploadet noget endnu/i);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.pdf")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/Kunne ikke uploade/);
  });

  it("says so when the file was stored but could not be parsed (200 + status:failed)", async () => {
    // prod 2026-09-16: every .docx failed on an expired parse key; the route
    // still answers 200, the list (parsed-only) stays empty, and without this
    // message the student sees the spinner stop and nothing else.
    listMyDocuments.mockResolvedValue([]);
    uploadDocument.mockResolvedValueOnce({ docId: "d9", name: "essay.docx", status: "failed", error: "key" });
    const { container } = render(<StudentDocumentWorkbench skillId="s" />);
    await screen.findByText(/ikke uploadet noget endnu/i);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "essay.docx")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/kunne ikke læses/);
    // The surface is intact — the student can try another file.
    expect(screen.getAllByRole("button", { name: /Upload fil eller billede/ }).length).toBeGreaterThan(0);
  });

  it("tells the student WHY an unsupported file type was rejected", async () => {
    const { DocumentApiError } = await import("@/lib/documentApi");
    listMyDocuments.mockResolvedValue([]);
    uploadDocument.mockRejectedValueOnce(new DocumentApiError("File type '.exe' is not supported.", 400));
    const { container } = render(<StudentDocumentWorkbench skillId="s" />);
    await screen.findByText(/ikke uploadet noget endnu/i);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.exe")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/Denne filtype understøttes ikke her/);
  });

  it("rejects an oversized file BEFORE calling the API — no silent hang", async () => {
    listMyDocuments.mockResolvedValue([]);
    const { container } = render(<StudentDocumentWorkbench skillId="s" />);
    await screen.findByText(/ikke uploadet noget endnu/i);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(bigFile, "size", { value: 21 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [bigFile] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/for stor/);
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("tells the student WHY the backend rejected an oversized file (413)", async () => {
    const { DocumentApiError } = await import("@/lib/documentApi");
    listMyDocuments.mockResolvedValue([]);
    uploadDocument.mockRejectedValueOnce(new DocumentApiError("File is too large.", 413));
    const { container } = render(<StudentDocumentWorkbench skillId="s" />);
    await screen.findByText(/ikke uploadet noget endnu/i);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.pdf")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/for stor/);
  });

  it("passes role=teacher through to the document API (builder preview)", async () => {
    listMyDocuments.mockResolvedValue([]);
    render(<StudentDocumentWorkbench skillId="s" role="teacher" />);
    await waitFor(() => expect(listMyDocuments).toHaveBeenCalledWith("s", "teacher"));
  });

  // 1.1.122 — one upload, the system routes. The student never picks a surface
  // by file type; a photo goes through the same button as a PDF.
  it("accepts images in the picker", async () => {
    listMyDocuments.mockResolvedValue([]);
    const { container } = render(<StudentDocumentWorkbench skillId="s" />);
    await screen.findByText(/ikke uploadet noget endnu/i);
    const accept = (container.querySelector('input[type="file"]') as HTMLInputElement).accept;
    for (const ext of [".png", ".jpg", ".heic", ".pdf", ".docx"]) expect(accept).toContain(ext);
  });

  it("downscales a picked photo on device and uploads the result through the document route", async () => {
    listMyDocuments.mockResolvedValue([]);
    resizeImageFile.mockResolvedValue({ mimeType: "image/jpeg", data: btoa("jpeg-bytes"), name: "ligning.png" });
    uploadDocument.mockResolvedValue({ docId: "img1", name: "ligning.jpg", status: "parsed" });
    const { container } = render(<StudentDocumentWorkbench skillId="phys-2" />);
    await screen.findByText(/ikke uploadet noget endnu/i);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const photo = new File(["png-bytes"], "ligning.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [photo] } });

    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1));
    expect(resizeImageFile).toHaveBeenCalledWith(photo);
    const [sent, skillId] = uploadDocument.mock.calls[0] as [File, string];
    expect(skillId).toBe("phys-2");
    expect(sent.name).toBe("ligning.jpg");
    expect(sent.type).toBe("image/jpeg");
  });

  it("does not touch a PDF on the way through", async () => {
    listMyDocuments.mockResolvedValue([]);
    uploadDocument.mockResolvedValue({ docId: "d1", name: "rapport.pdf", status: "parsed" });
    const { container } = render(<StudentDocumentWorkbench skillId="s" />);
    await screen.findByText(/ikke uploadet noget endnu/i);
    const pdf = new File(["%PDF"], "rapport.pdf", { type: "application/pdf" });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [pdf] } });
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1));
    expect(resizeImageFile).not.toHaveBeenCalled();
    expect(uploadDocument.mock.calls[0][0]).toBe(pdf);
  });

  it("shows an image tab with an image icon, alongside a document tab", async () => {
    listMyDocuments.mockResolvedValue([
      { docId: "d1", name: "opgave.pdf", sourceFormat: "pdf" },
      { docId: "i1", name: "ligning.jpg", sourceFormat: "jpg" },
    ]);
    render(<StudentDocumentWorkbench skillId="s" />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["opgave.pdf", "ligning.jpg"]);
    expect(tabs[0].querySelector("svg.lucide-file-text")).not.toBeNull();
    expect(tabs[1].querySelector("svg.lucide-image")).not.toBeNull();
  });

  it("no longer steers a student to the chat for an unsupported type", async () => {
    const { DocumentApiError } = await import("@/lib/documentApi");
    listMyDocuments.mockResolvedValue([]);
    uploadDocument.mockRejectedValueOnce(new DocumentApiError("File type '.exe' is not supported.", 400));
    const { container } = render(<StudentDocumentWorkbench skillId="s" />);
    await screen.findByText(/ikke uploadet noget endnu/i);
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "a.exe")] },
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Denne filtype understøttes ikke her/);
    expect(alert).not.toHaveTextContent(/chatten/);
  });
});
