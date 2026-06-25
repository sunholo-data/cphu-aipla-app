import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const onProactiveTrigger = vi.fn();
const optsRef = { current: { skillId: "s", onProactiveTrigger } };
vi.mock("@/contexts/ProactiveSimContext", () => ({
  useOptionalProactiveSimOptsRef: () => optsRef,
}));

// Mock the 1.1.7 image stack — assert the staged photo(s) reach the tutor turn.
const mockClear = vi.fn();
const mockState: { value: ReturnType<typeof makePhoto> } = { value: makePhoto(0) };
function makePhoto(count: number) {
  return {
    staged: Array.from({ length: count }, (_, i) => ({ id: `s${i}` })),
    notice: null as string | null,
    count,
    attachments: Array.from({ length: count }, () => ({ data: "img" })),
    addFiles: vi.fn(),
    remove: vi.fn(),
    clear: mockClear,
  };
}
vi.mock("@/hooks/useImageAttachments", () => ({
  MAX_IMAGES: 4,
  useImageAttachments: () => mockState.value,
}));
vi.mock("@/components/chat/ImageComposer", () => ({
  ImageStagingRow: () => <div data-testid="staging" />,
  ImageUploadButtons: () => <div data-testid="upload-buttons" />,
}));

import { SolutionElementMount } from "../SolutionElementMount";

const DEF = [{ id: "sol-1", prompt: "Skriv din løsning" }];

afterEach(() => vi.clearAllMocks());

describe("SolutionElementMount — photo solution (1.1.48 M1)", () => {
  it("submits the staged photo(s) as a multimodal turn for tutor feedback", () => {
    mockState.value = makePhoto(1);
    render(<SolutionElementMount solution={DEF} />);
    fireEvent.click(screen.getByRole("button", { name: /send løsning/i }));

    expect(onProactiveTrigger).toHaveBeenCalledTimes(1);
    const [text, attachments] = onProactiveTrigger.mock.calls[0];
    expect(text).toMatch(/\S/); // non-empty (ag_ui_adk drops empty turns)
    expect(attachments).toEqual([{ data: "img" }]);
    expect(mockClear).toHaveBeenCalled();
  });

  it("disables submit until a photo is staged", () => {
    mockState.value = makePhoto(0);
    render(<SolutionElementMount solution={DEF} />);
    const btn = screen.getByRole("button", { name: /send løsning/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onProactiveTrigger).not.toHaveBeenCalled();
  });

  it("shows the teacher prompt and never renders a text/LaTeX editor", () => {
    mockState.value = makePhoto(0);
    render(<SolutionElementMount solution={[{ id: "sol-1", prompt: "Vis dine udregninger" }]} />);
    expect(screen.getByText("Vis dine udregninger")).toBeInTheDocument();
    expect(screen.getByTestId("upload-buttons")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no solution element", () => {
    mockState.value = makePhoto(0);
    const { container } = render(<SolutionElementMount solution={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
