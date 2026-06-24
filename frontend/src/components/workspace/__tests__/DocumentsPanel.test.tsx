import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DocumentsPanel } from "@/components/workspace/DocumentsPanel";

afterEach(() => vi.clearAllMocks());

const fetchCurriculumContent = vi.fn();
vi.mock("@/lib/curriculumApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/curriculumApi")>(
    "@/lib/curriculumApi",
  );
  return {
    ...actual,
    fetchCurriculumContent: (...a: unknown[]) => fetchCurriculumContent(...a),
  };
});

const fetchActivityImageObjectUrl = vi.fn();
vi.mock("@/lib/activityImageApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/activityImageApi")>(
    "@/lib/activityImageApi",
  );
  return {
    ...actual,
    fetchActivityImageObjectUrl: (...a: unknown[]) => fetchActivityImageObjectUrl(...a),
  };
});

const reportDocumentEvent = vi.fn();
vi.mock("@/lib/documentApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documentApi")>("@/lib/documentApi");
  return { ...actual, reportDocumentEvent: (...a: unknown[]) => reportDocumentEvent(...a) };
});

// jsdom has no object-URL lifecycle; the component revokes on unmount.
URL.revokeObjectURL = vi.fn();

describe("DocumentsPanel", () => {
  it("returns null when there are no materials and no uploads", () => {
    const { container } = render(<DocumentsPanel materials={[]} images={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows shared docs prominently and cites not-shared ones by name (not contents)", () => {
    render(
      <DocumentsPanel
        materials={[
          { docId: "d1", origin: "A-level kinematics", studentVisible: true },
          { docId: "d2", origin: "Teacher worksheet", studentVisible: false },
        ]}
        images={[]}
      />,
    );
    // Shared doc is shown prominently + openable.
    expect(screen.getByText("A-level kinematics")).toBeTruthy();
    // Not-shared doc: its NAME is cited (visible, transparency), but not openable.
    expect(screen.getByText(/also used by the tutor/i)).toBeTruthy();
    expect(screen.getByText("Teacher worksheet")).toBeTruthy();
    // The not-shared name is plain text, NOT a clickable open-content button.
    expect(screen.queryByRole("button", { name: /Teacher worksheet/i })).toBeNull();
  });

  it("cites every not-shared material by name", () => {
    render(
      <DocumentsPanel
        materials={[
          { docId: "a", origin: "One", studentVisible: false },
          { docId: "b", origin: "Two", studentVisible: false },
        ]}
        images={[]}
      />,
    );
    expect(screen.getByText(/also used by the tutor/i)).toBeTruthy();
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("Two")).toBeTruthy();
  });

  it("renders an uploads gallery from session images", () => {
    render(
      <DocumentsPanel
        materials={[]}
        images={[{ mimeType: "image/png", data: "AAAA" }]}
      />,
    );
    expect(screen.getByText(/your uploads/i)).toBeTruthy();
    expect(screen.getByRole("img", { name: "your upload" })).toBeTruthy();
  });

  it("opens a viewer with the parsed content when a shared doc is clicked (M3)", async () => {
    fetchCurriculumContent.mockResolvedValue({
      docId: "d1",
      title: "A-level kinematics",
      available: true,
      text: "Newton's second law: F = m a.",
      chars: 29,
    });
    render(
      <DocumentsPanel
        materials={[{ docId: "d1", origin: "A-level kinematics", studentVisible: true }]}
        images={[]}
        activityId="act-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /A-level kinematics/i }));
    // Student workbench MUST use the anonymous-group token, not teacher auth
    // (else 401 — a student has no Firebase identity).
    expect(fetchCurriculumContent).toHaveBeenCalledWith("d1", "act-1", { as: "student" });
    await waitFor(() =>
      expect(screen.getByText(/Newton's second law/)).toBeInTheDocument(),
    );
  });

  it("renders a teacher-shared image material as an image (1.1.44 M4)", async () => {
    fetchActivityImageObjectUrl.mockResolvedValue("blob:fake-url");
    render(
      <DocumentsPanel
        materials={[
          {
            kind: "image",
            docId: "",
            origin: "",
            studentVisible: true,
            materialId: "img-1",
            mimeType: "image/png",
            alt: "free-body diagram",
          },
        ]}
        images={[]}
        activityId="act-1"
      />,
    );
    // Fetched with the student token (default role) against the bound activity.
    await waitFor(() =>
      expect(fetchActivityImageObjectUrl).toHaveBeenCalledWith("act-1", "img-1", "student"),
    );
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "free-body diagram" })).toBeInTheDocument(),
    );
  });

  it("does NOT fetch a not-shared image; lists it by name only (1.1.44 M4)", () => {
    render(
      <DocumentsPanel
        materials={[
          {
            kind: "image",
            docId: "",
            origin: "",
            studentVisible: false,
            materialId: "img-2",
            mimeType: "image/png",
            alt: "secret graph",
          },
        ]}
        images={[]}
        activityId="act-1"
      />,
    );
    expect(fetchActivityImageObjectUrl).not.toHaveBeenCalled();
    expect(screen.getByText(/also used by the tutor/i)).toBeTruthy();
    expect(screen.getByText("secret graph")).toBeTruthy();
  });

  it("shows a graceful note when a doc has no stored content (M3)", async () => {
    fetchCurriculumContent.mockResolvedValue({
      docId: "d1",
      title: "Old doc",
      available: false,
      text: "",
      chars: 0,
    });
    render(
      <DocumentsPanel
        materials={[{ docId: "d1", origin: "Old doc", studentVisible: true }]}
        images={[]}
        activityId="act-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Old doc/i }));
    await waitFor(() =>
      expect(screen.getByText(/isn't available to read here yet/i)).toBeInTheDocument(),
    );
  });

  it("renders the opened doc content INLINE (no modal dialog)", async () => {
    fetchCurriculumContent.mockResolvedValue({
      docId: "d1",
      title: "A-level kinematics",
      available: true,
      text: "Inline body text.",
      chars: 17,
    });
    render(
      <DocumentsPanel
        materials={[{ docId: "d1", origin: "A-level kinematics", studentVisible: true }]}
        images={[]}
        activityId="act-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /A-level kinematics/i }));
    await waitFor(() => expect(screen.getByText(/Inline body text/)).toBeInTheDocument());
    // Inline pane, not a modal — there must be no dialog role, and the source
    // button stays in the document (so the student can switch / it stays visible).
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /A-level kinematics/i })).toBeInTheDocument();
    // Closing the inline pane hides the content but keeps the source list.
    fireEvent.click(screen.getByRole("button", { name: /close document/i }));
    await waitFor(() => expect(screen.queryByText(/Inline body text/)).toBeNull());
    expect(screen.getByRole("button", { name: /A-level kinematics/i })).toBeInTheDocument();
  });

  it("reports a document.open interaction for research when a shared doc is opened (1.1.45 M5)", async () => {
    fetchCurriculumContent.mockResolvedValue({
      docId: "d1",
      title: "Haka Fysik",
      available: true,
      text: "Energi.",
      chars: 7,
    });
    render(
      <DocumentsPanel
        materials={[{ docId: "d1", origin: "Haka Fysik", studentVisible: true }]}
        images={[]}
        activityId="act-1"
        sessionId="sess-1"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Haka Fysik" }));
    expect(reportDocumentEvent).toHaveBeenCalledWith("sess-1", { kind: "document.open", docId: "d1" });
  });
});
