import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActingForOwnerBanner, LastEditedLine } from "@/components/teacher/ActingForOwnerBanner";

const authState: { uid: string | null } = { uid: "teacher-1" };
vi.mock("@/hooks/useTeacherAuth", () => ({
  useTeacherAuth: () => ({ user: authState.uid ? { uid: authState.uid } : null, loading: false }),
}));

/**
 * 1.1.123 M0 — the "whose is this" banner. The whole point is the two ends:
 * the owner sees nothing; a researcher on someone else's resource is told so.
 */
describe("ActingForOwnerBanner", () => {
  it("renders nothing for the owner", () => {
    authState.uid = "teacher-1";
    const { container } = render(<ActingForOwnerBanner resource={{ ownerUid: "teacher-1" }} kind="class" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the owner for a non-owner viewer, preferring the label", () => {
    authState.uid = "researcher-1";
    render(<ActingForOwnerBanner resource={{ ownerUid: "teacher-1", ownerLabel: "Bob" }} kind="class" />);
    expect(screen.getByTestId("acting-for-owner-banner")).toHaveTextContent("You are editing Bob’s class as a researcher.");
  });

  it("falls back to the uid and speaks of an activity when told to", () => {
    authState.uid = "researcher-1";
    render(<ActingForOwnerBanner resource={{ ownerUid: "teacher-1" }} kind="activity" />);
    expect(screen.getByTestId("acting-for-owner-banner")).toHaveTextContent("teacher-1’s activity");
  });

  it("stays hidden until the viewer is known — never a wrong claim on first paint", () => {
    authState.uid = null;
    const { container } = render(<ActingForOwnerBanner resource={{ ownerUid: "teacher-1" }} kind="class" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LastEditedLine", () => {
  it("renders nothing when only the owner has ever written the document", () => {
    const { container } = render(<LastEditedLine resource={{ lastEditedBy: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says who, with the label, and when", () => {
    render(
      <LastEditedLine
        resource={{ lastEditedBy: { uid: "r-1", at: new Date(Date.now() - 2 * 3600_000).toISOString() }, lastEditedByLabel: "JB" }}
      />,
    );
    expect(screen.getByTestId("last-edited-line")).toHaveTextContent(/Last edited by JB, 2 hours ago/);
  });

  it("never shows a raw uid when no label resolved", () => {
    render(<LastEditedLine resource={{ lastEditedBy: { uid: "r-1", at: new Date().toISOString() } }} />);
    const line = screen.getByTestId("last-edited-line");
    expect(line).toHaveTextContent(/another researcher/);
    expect(line).not.toHaveTextContent("r-1");
  });
});
