import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Capture the props the preview passes to the (mocked) workspace renderer —
// this test covers the pane's logic, not the shipped renderers.
const { wsSpy } = vi.hoisted(() => ({ wsSpy: vi.fn() }));
vi.mock("@/components/workspace/elementRenderers", () => ({
  WorkspaceElements: (props: Record<string, unknown>) => {
    wsSpy(props);
    return <div data-testid="workspace-elements" />;
  },
}));

const listArtefactsMock = vi.fn();
vi.mock("@/lib/teacherApi", async (orig) => {
  const actual = await orig<typeof import("@/lib/teacherApi")>();
  return { ...actual, listArtefacts: () => listArtefactsMock() };
});

// 1.1.45 — capture the image-bytes fetch the (real) DocumentsPanel makes for an
// image material, to lock in that the preview keeps kind="image" + the real id.
const imgFetch = vi.fn();
vi.mock("@/lib/activityImageApi", async (orig) => {
  const actual = await orig<typeof import("@/lib/activityImageApi")>();
  return { ...actual, fetchActivityImageObjectUrl: (...a: unknown[]) => imgFetch(...a) };
});
URL.revokeObjectURL = vi.fn();

import { ActivityPreview } from "../ActivityPreview";
import { type BuilderElements } from "@/lib/activityPreview";

const EMPTY: BuilderElements = {
  checklist: [],
  table: [],
  chart: [],
  calculator: null,
  note: null,
  writing: [],
  solution: null,
  document: null,
  conceptMap: null,
};
const WITH_CHECKLIST: BuilderElements = { ...EMPTY, checklist: [{ key: 1, label: "Step" }] };

describe("ActivityPreview", () => {
  it("shows an empty hint when there are no elements", () => {
    render(<ActivityPreview state={EMPTY} />);
    expect(screen.getByText(/tilføj elementer/i)).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-elements")).not.toBeInTheDocument();
  });

  it("renders the workspace from converted builder state, sandboxed (sessionId null)", () => {
    wsSpy.mockClear();
    render(<ActivityPreview state={WITH_CHECKLIST} />);
    expect(screen.getByTestId("workspace-elements")).toBeInTheDocument();
    expect(wsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: null,
        checklist: [{ id: "step-1", label: "Step" }],
      }),
    );
  });

  it("surfaces an attached simulation (and so isn't 'empty') even with no elements", async () => {
    listArtefactsMock.mockResolvedValue([
      {
        id: "boldkast",
        displayName: "Boldkast",
        description: "Projektil",
        topics: [],
        levels: [],
        language: "da",
        artefactPath: "boldkast/v1",
        status: "live",
      },
    ]);
    render(<ActivityPreview state={EMPTY} artefactId="boldkast" />);
    // The sim counts as workspace content, so the empty hint must NOT show.
    expect(screen.queryByText(/tilføj elementer/i)).not.toBeInTheDocument();
    // The sim is named in the preview (the labelled card when no sandbox origin
    // is configured in the test env; the live frame uses the same name).
    expect(await screen.findByText("Boldkast")).toBeInTheDocument();
  });

  it("pops the preview out to a full-screen dialog and closes it", async () => {
    listArtefactsMock.mockResolvedValue([
      {
        id: "boldkast",
        displayName: "Boldkast",
        description: "Projektil",
        topics: [],
        levels: [],
        language: "da",
        artefactPath: "boldkast/v1",
        status: "live",
      },
    ]);
    const { container } = render(<ActivityPreview state={WITH_CHECKLIST} artefactId="boldkast" />);
    fireEvent.click(screen.getByRole("button", { name: /full-size/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Boldkast")).toBeInTheDocument();
    expect(within(dialog).getByTestId("workspace-elements")).toBeInTheDocument();
    // Portalled OUT of the component's subtree (to document.body) so the
    // builder's sticky right column can't trap the overlay below the left
    // column's sticky section nav (z-index regression).
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the full-screen dialog on Escape and moves focus into it on open", async () => {
    listArtefactsMock.mockResolvedValue([]);
    render(<ActivityPreview state={WITH_CHECKLIST} />);
    fireEvent.click(screen.getByRole("button", { name: /full-size/i }));
    const dialog = await screen.findByRole("dialog");
    // Radix traps focus inside the modal — focus lands within it on open.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("renders an image material via the activity-image fetch with the REAL activityId (1.1.45 regression)", async () => {
    imgFetch.mockResolvedValue("blob:fake");
    render(
      <ActivityPreview
        state={EMPTY}
        activityId="act-real"
        materials={[
          {
            kind: "image",
            docId: "",
            origin: "",
            materialId: "img1",
            mimeType: "image/png",
            alt: "diagram",
            studentVisible: true,
          },
        ]}
      />,
    );
    // If the preview dropped kind/materialId (the bug) it would treat this as a
    // curriculum doc and never hit the image fetch; if it kept the placeholder id
    // it would fetch the wrong slot. Both are pinned here.
    await waitFor(() => expect(imgFetch).toHaveBeenCalledWith("act-real", "img1", "teacher"));
  });

  it("collapses and expands the preview", () => {
    render(<ActivityPreview state={WITH_CHECKLIST} />);
    expect(screen.getByTestId("workspace-elements")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.queryByTestId("workspace-elements")).not.toBeInTheDocument();
  });
});
