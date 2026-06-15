import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentsPanel } from "@/components/workspace/DocumentsPanel";

describe("DocumentsPanel", () => {
  it("returns null when there are no materials and no uploads", () => {
    const { container } = render(<DocumentsPanel materials={[]} images={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows every material NAME (names-always) with shared / not-shared badges", () => {
    render(
      <DocumentsPanel
        materials={[
          { docId: "d1", origin: "A-level kinematics", studentVisible: true },
          { docId: "d2", origin: "Teacher worksheet", studentVisible: false },
        ]}
        images={[]}
      />,
    );
    // Both names appear regardless of visibility (debug / transparency).
    expect(screen.getByText("A-level kinematics")).toBeTruthy();
    expect(screen.getByText("Teacher worksheet")).toBeTruthy();
    // ...with the right badge each.
    expect(screen.getByText("Shared")).toBeTruthy();
    expect(screen.getByText("Not shared")).toBeTruthy();
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
