import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DocumentsPanel } from "@/components/workspace/DocumentsPanel";

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

describe("DocumentsPanel", () => {
  it("returns null when there are no materials and no uploads", () => {
    const { container } = render(<DocumentsPanel materials={[]} images={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("lists shared docs prominently and tucks not-shared ones into a collapsed disclosure", () => {
    render(
      <DocumentsPanel
        materials={[
          { docId: "d1", origin: "A-level kinematics", studentVisible: true },
          { docId: "d2", origin: "Teacher worksheet", studentVisible: false },
        ]}
        images={[]}
      />,
    );
    // Shared doc is shown prominently.
    expect(screen.getByText("A-level kinematics")).toBeTruthy();
    // Not-shared docs collapse into a compact disclosure (names still in the
    // DOM for debug/transparency, just minimised by default).
    expect(
      screen.getByText(/1 more source the tutor uses \(not shared with you\)/i),
    ).toBeTruthy();
    expect(screen.getByText("Teacher worksheet")).toBeTruthy();
  });

  it("pluralises the not-shared disclosure", () => {
    render(
      <DocumentsPanel
        materials={[
          { docId: "a", origin: "One", studentVisible: false },
          { docId: "b", origin: "Two", studentVisible: false },
        ]}
        images={[]}
      />,
    );
    expect(screen.getByText(/2 more sources the tutor uses/i)).toBeTruthy();
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
});
