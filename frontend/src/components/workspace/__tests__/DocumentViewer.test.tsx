import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// react-pdf can't render in jsdom (canvas/worker) — mock it; assert the chrome.
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ children }: { children?: unknown }) => <div data-testid="pdf-doc">{children as never}</div>,
  Page: ({ pageNumber }: { pageNumber: number }) => <div data-testid="pdf-page">page {pageNumber}</div>,
}));

const fetchDocumentObjectUrl = vi.fn();
vi.mock("@/lib/documentApi", () => ({
  fetchDocumentObjectUrl: (...a: unknown[]) => fetchDocumentObjectUrl(...a),
  DocumentApiError: class extends Error {},
}));

URL.revokeObjectURL = vi.fn();

import { DocumentViewer } from "../DocumentViewer";

afterEach(() => vi.clearAllMocks());

describe("DocumentViewer (1.1.45 M2)", () => {
  it("renders no file-tab strip for a single file", async () => {
    fetchDocumentObjectUrl.mockResolvedValue("blob:fake");
    render(<DocumentViewer files={[{ docId: "d1", name: "report.pdf", mimeType: "application/pdf" }]} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("renders a file-tab strip and switches the active file", async () => {
    fetchDocumentObjectUrl.mockResolvedValue("blob:fake");
    render(
      <DocumentViewer
        files={[
          { docId: "d1", name: "report.pdf", mimeType: "application/pdf" },
          { docId: "d2", name: "notes.pdf", mimeType: "application/pdf" },
        ]}
      />,
    );
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /report\.pdf/i })).toBeInTheDocument();
    const second = screen.getByRole("tab", { name: /notes\.pdf/i });
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-selected", "true");
  });

  it("renders the PDF viewer chrome (page nav, zoom, download) for a PDF", async () => {
    fetchDocumentObjectUrl.mockResolvedValue("blob:fake");
    render(<DocumentViewer files={[{ docId: "d1", name: "report.pdf", mimeType: "application/pdf" }]} />);
    expect(await screen.findByTestId("pdf-doc")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByLabelText(/download/i)).toBeInTheDocument();
  });

  it("renders an image (not the PDF chrome) for an image file", async () => {
    fetchDocumentObjectUrl.mockResolvedValue("blob:fake");
    render(<DocumentViewer files={[{ docId: "d1", name: "diagram.png", mimeType: "image/png" }]} />);
    expect(await screen.findByRole("img", { name: "diagram.png" })).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-doc")).not.toBeInTheDocument();
  });

  it("shows an honest error when the bytes fail to load", async () => {
    fetchDocumentObjectUrl.mockRejectedValue(new Error("403"));
    render(<DocumentViewer files={[{ docId: "d1", name: "report.pdf", mimeType: "application/pdf" }]} />);
    expect(await screen.findByText(/couldn't open report\.pdf/i)).toBeInTheDocument();
  });
});
