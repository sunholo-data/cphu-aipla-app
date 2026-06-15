import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentsPanel } from "@/components/workspace/DocumentsPanel";

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
});
