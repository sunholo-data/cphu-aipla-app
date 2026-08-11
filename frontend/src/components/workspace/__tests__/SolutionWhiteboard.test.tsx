import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// perfect-freehand is a pure function; canvas itself isn't rendered in jsdom, so
// these tests cover the toolbar + wiring (drawing + export need a real browser).
vi.mock("perfect-freehand", () => ({ getStroke: () => [] }));

import { SolutionWhiteboard } from "../SolutionWhiteboard";

const onAdd = vi.fn();

/** Put one item on the board without pointer capture: the TEXT tool appends a
 *  TextItem from a `window.prompt`, which jsdom can drive. Drawing a stroke
 *  needs `setPointerCapture`, which it cannot. */
function addTextItem(label = "F_g") {
  fireEvent.click(screen.getByRole("button", { name: "Tekst" }));
  vi.spyOn(window, "prompt").mockReturnValue(label);
  fireEvent.pointerDown(screen.getByLabelText("Tegneflade"), { clientX: 10, clientY: 10 });
}

/** jsdom has no canvas backend: `getContext` returns null and `toBlob` doesn't
 *  exist, so the compositing path would bail before doing anything observable.
 *  Stub both so the export/download wiring is actually exercised. */
function stubCanvas() {
  const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), clearRect: vi.fn(), fill: vi.fn(), fillText: vi.fn(), setTransform: vi.fn(), font: "", textBaseline: "" };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(["png"], { type: "image/png" }));
  };
}

beforeEach(() => {
  stubCanvas();
  URL.createObjectURL = vi.fn(() => "blob:stub");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("SolutionWhiteboard (1.1.48 M2)", () => {
  it("renders the drawing tools (incl. a text tool) + a canvas", () => {
    render(<SolutionWhiteboard onAdd={onAdd} />);
    for (const name of ["Pen", "Tekst", "Viskelæder", "Fortryd", "Ryd"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Tegneflade")).toBeInTheDocument();
  });

  it("disables 'Tilføj tegning' until there is something on the board", () => {
    render(<SolutionWhiteboard onAdd={onAdd} />);
    expect((screen.getByRole("button", { name: /tilføj tegning/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("selecting the text tool shows the placement hint", () => {
    render(<SolutionWhiteboard onAdd={onAdd} />);
    expect(screen.queryByText(/placere en tekst/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tekst" }));
    expect(screen.getByText(/placere en tekst/i)).toBeInTheDocument();
  });

  it("toggles the active tool between pen, text and eraser", () => {
    render(<SolutionWhiteboard onAdd={onAdd} />);
    const eraser = screen.getByRole("button", { name: "Viskelæder" });
    fireEvent.click(eraser);
    expect(eraser).toHaveAttribute("aria-pressed", "true");
    const text = screen.getByRole("button", { name: "Tekst" });
    fireEvent.click(text);
    expect(text).toHaveAttribute("aria-pressed", "true");
    expect(eraser).toHaveAttribute("aria-pressed", "false");
  });
});

describe("SolutionWhiteboard — keeping the drawing (1.1.73 M3)", () => {
  it("disables 'Hent tegning' until there is something on the board", () => {
    render(<SolutionWhiteboard onAdd={onAdd} />);
    expect((screen.getByRole("button", { name: /hent tegning/i }) as HTMLButtonElement).disabled).toBe(true);
    addTextItem();
    expect((screen.getByRole("button", { name: /hent tegning/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("'Hent tegning' downloads a PNG without sending it to the tutor", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<SolutionWhiteboard onAdd={onAdd} />);
    addTextItem();

    fireEvent.click(screen.getByRole("button", { name: /hent tegning/i }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    // Downloading is not sharing — the tutor gets nothing from this button.
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("'Tilføj tegning' stages the image and LEAVES the ink on the board", async () => {
    // The regression this guards: add() used to setItems([]), so a student who
    // sent a diagram could not then revise it. Ink surviving the send is what
    // makes the board revisable.
    render(<SolutionWhiteboard onAdd={onAdd} />);
    addTextItem();

    fireEvent.click(screen.getByRole("button", { name: /tilføj tegning/i }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect((onAdd.mock.calls[0][0] as File).type).toBe("image/png");
    // Both buttons still enabled => hasInk is still true => the board was not wiped.
    expect((screen.getByRole("button", { name: /tilføj tegning/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /hent tegning/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("'Ryd' is still the way to clear the board", () => {
    render(<SolutionWhiteboard onAdd={onAdd} />);
    addTextItem();
    expect((screen.getByRole("button", { name: /tilføj tegning/i }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Ryd" }));

    expect((screen.getByRole("button", { name: /tilføj tegning/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /hent tegning/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
