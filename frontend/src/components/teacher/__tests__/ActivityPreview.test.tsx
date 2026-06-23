import { fireEvent, render, screen } from "@testing-library/react";
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

import { ActivityPreview } from "../ActivityPreview";
import { type BuilderElements } from "@/lib/activityPreview";

const EMPTY: BuilderElements = { checklist: [], table: null, chart: null, calculator: null, note: null };
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

  it("collapses and expands the preview", () => {
    render(<ActivityPreview state={WITH_CHECKLIST} />);
    expect(screen.getByTestId("workspace-elements")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.queryByTestId("workspace-elements")).not.toBeInTheDocument();
  });
});
