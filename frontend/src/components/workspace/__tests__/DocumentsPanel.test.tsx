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
    expect(fetchCurriculumContent).toHaveBeenCalledWith("d1", "act-1");
    await waitFor(() =>
      expect(screen.getByText(/Newton's second law/)).toBeInTheDocument(),
    );
  });

  it("tells the student to re-upload when a doc has no stored content (M3)", async () => {
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
      expect(screen.getByText(/re-upload it to read it here/i)).toBeInTheDocument(),
    );
  });
});
