import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImageStagingRow, PhotoCaptureButton } from "@/components/chat/ImageComposer";
import { StudentViewPicker } from "@/components/teacher/StudentViewPicker";
import { parseStudentView } from "@/lib/studentView";
import type { StagedImage } from "@/hooks/useImageAttachments";
import { ChatRevealTab } from "../ChatRevealTab";
import { WorkspaceDivider } from "../WorkspaceDivider";
import { WorkspaceShell } from "../WorkspaceShell";

// Student view (2026-11-09). The work-first view moves the workspace to the
// LEFT with CSS order; the photo view adds one big photo button and a large
// preview. What each test pins is the half that would silently break: a divider
// that still measures from the right drags the wrong way, and a staged photo
// shown as a thumbnail is the 3 Nov complaint unchanged.

function rowWith(node: React.ReactNode) {
  render(
    <div data-workspace-row data-testid="row">
      {node}
    </div>,
  );
  Object.defineProperty(screen.getByTestId("row"), "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, right: 1000, top: 0, bottom: 800, width: 1000, height: 800 }) as DOMRect,
  });
}

function drag(toX: number) {
  const sep = screen.getByRole("separator");
  fireEvent.pointerDown(sep, { clientX: 500 });
  act(() => {
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: toX }) as PointerEvent);
    document.dispatchEvent(new MouseEvent("pointerup"));
  });
}

describe("work-first view — the workspace leads", () => {
  it("a right-hand workspace grows when the divider is dragged LEFT (unchanged)", () => {
    const onChange = vi.fn();
    rowWith(<WorkspaceDivider ratio={0.5} onChange={onChange} />);
    drag(400);
    expect(onChange).toHaveBeenLastCalledWith(0.6);
  });

  it("a left-hand workspace grows when the divider is dragged RIGHT", () => {
    const onChange = vi.fn();
    rowWith(<WorkspaceDivider ratio={0.5} onChange={onChange} side="left" />);
    drag(650);
    expect(onChange).toHaveBeenLastCalledWith(0.65);
  });

  it("the shell takes the first slot on md+ and borders its right edge", () => {
    render(
      <WorkspaceShell ratio={0.65} onRatioChange={() => {}} side="left">
        <p>work</p>
      </WorkspaceShell>,
    );
    const aside = screen.getByText("work").closest("aside");
    expect(aside?.className).toContain("md:order-first");
    expect(aside?.className).toContain("md:border-r");
    expect(aside?.className).not.toContain("md:border-l");
  });

  it("today's layout is untouched by default", () => {
    render(
      <WorkspaceShell ratio={0.5} onRatioChange={() => {}}>
        <p>work</p>
      </WorkspaceShell>,
    );
    const aside = screen.getByText("work").closest("aside");
    expect(aside?.className).not.toContain("md:order-first");
    expect(aside?.className).toContain("md:border-l");
  });

  it("with the chat hidden, the show-chat tab sits on the edge the chat returns to", () => {
    const { rerender } = render(<ChatRevealTab onReveal={() => {}} side="left" />);
    expect(screen.getByRole("button").className).toContain("right-0");
    rerender(<ChatRevealTab onReveal={() => {}} />);
    expect(screen.getByRole("button").className).toContain("left-0");
  });
});

describe("photo view — one big button, a large preview", () => {
  const staged: StagedImage[] = [
    { id: "a", name: "model.jpg", previewUrl: "blob:a" } as StagedImage,
  ];

  it("the big button opens a picker WITHOUT capture, so a phone offers camera and library", () => {
    const { container } = render(<PhotoCaptureButton onFiles={() => {}} lang="da" />);
    expect(screen.getByRole("button", { name: /Tag eller vælg et billede/ })).toBeEnabled();
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input).not.toHaveAttribute("capture");
  });

  it("goes inert at the per-message cap", () => {
    render(<PhotoCaptureButton onFiles={() => {}} full lang="en" />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows a staged photo large and says it can be enlarged", () => {
    render(<ImageStagingRow staged={staged} notice={null} onRemove={() => {}} large lang="da" />);
    const img = screen.getByRole("img", { name: "model.jpg" });
    expect(img.className).toContain("max-h-64");
    expect(screen.getByText("Tryk for at forstørre")).toBeInTheDocument();
  });

  it("keeps the thumbnail strip in every other view", () => {
    render(<ImageStagingRow staged={staged} notice={null} onRemove={() => {}} />);
    expect(screen.getByRole("img", { name: "model.jpg" }).className).toContain("h-14");
    expect(screen.queryByText(/forstørre|enlarge/)).toBeNull();
  });
});

describe("the teacher's picker", () => {
  it("offers the three views and reports the choice", () => {
    const onChange = vi.fn();
    render(<StudentViewPicker value="chat" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0]).toBeChecked();
    fireEvent.click(radios[1]);
    expect(onChange).toHaveBeenCalledWith("workbench");
  });

  it("an unknown value from the server reads as today's layout", () => {
    expect(parseStudentView("drawer")).toBe("chat");
    expect(parseStudentView(undefined)).toBe("chat");
    expect(parseStudentView("photo")).toBe("photo");
  });
});
