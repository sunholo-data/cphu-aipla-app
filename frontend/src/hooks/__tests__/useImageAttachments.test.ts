import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the heavy browser libs so the hook's staging logic (cap, guardrail
// block, cleanup) is tested deterministically without canvas/FaceDetector.
vi.mock("@/lib/imageResize", () => ({
  resizeImageFile: vi.fn(async (f: File) => ({
    mimeType: "image/jpeg",
    data: "QkFTRTY0",
    name: f.name,
  })),
}));
vi.mock("@/lib/personGuardrail", () => ({
  screenImageForPerson: vi.fn(async () => ({
    blocked: false,
    degraded: false,
    faceCount: 0,
    message: null,
  })),
}));

import { resizeImageFile } from "@/lib/imageResize";
import { screenImageForPerson } from "@/lib/personGuardrail";
import { MAX_IMAGES, useImageAttachments } from "@/hooks/useImageAttachments";

const img = (name: string) => new File(["x"], name, { type: "image/png" });

let revoked: string[] = [];

beforeEach(() => {
  revoked = [];
  let n = 0;
  // jsdom doesn't implement object URLs — stub them.
  globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${n++}`);
  globalThis.URL.revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useImageAttachments", () => {
  it("stages an accepted image and exposes its encoded base64", async () => {
    const { result } = renderHook(() => useImageAttachments());
    await act(async () => {
      await result.current.addFiles([img("a.png")]);
    });
    expect(result.current.count).toBe(1);
    expect(result.current.attachments[0].data).toBe("QkFTRTY0");
  });

  it("skips non-image files entirely", async () => {
    const { result } = renderHook(() => useImageAttachments());
    const pdf = new File(["x"], "doc.pdf", { type: "application/pdf" });
    await act(async () => {
      await result.current.addFiles([pdf]);
    });
    expect(result.current.count).toBe(0);
    expect(resizeImageFile).not.toHaveBeenCalled();
  });

  it("enforces the per-turn cap with a notice", async () => {
    const { result } = renderHook(() => useImageAttachments());
    const files = Array.from({ length: MAX_IMAGES + 2 }, (_, i) => img(`f${i}.png`));
    await act(async () => {
      await result.current.addFiles(files);
    });
    expect(result.current.count).toBe(MAX_IMAGES);
    expect(result.current.notice).toMatch(/up to/i);
  });

  it("does not stage a guardrail-blocked image and surfaces the message", async () => {
    vi.mocked(screenImageForPerson).mockResolvedValueOnce({
      blocked: true,
      degraded: false,
      faceCount: 1,
      message: "retake please",
    });
    const { result } = renderHook(() => useImageAttachments());
    await act(async () => {
      await result.current.addFiles([img("face.png")]);
    });
    expect(result.current.count).toBe(0);
    expect(result.current.notice).toBe("retake please");
  });

  it("remove() drops the image and revokes its object URL", async () => {
    const { result } = renderHook(() => useImageAttachments());
    await act(async () => {
      await result.current.addFiles([img("a.png")]);
    });
    const id = result.current.staged[0].id;
    const url = result.current.staged[0].previewUrl;
    act(() => result.current.remove(id));
    expect(result.current.count).toBe(0);
    expect(revoked).toContain(url);
  });

  it("clear() empties the staging and revokes every URL", async () => {
    const { result } = renderHook(() => useImageAttachments());
    await act(async () => {
      await result.current.addFiles([img("a.png"), img("b.png")]);
    });
    await waitFor(() => expect(result.current.count).toBe(2));
    const urls = result.current.staged.map((s) => s.previewUrl);
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
    expect(result.current.notice).toBeNull();
    urls.forEach((u) => expect(revoked).toContain(u));
  });
});

describe("handlePaste — 1.1.85 M2", () => {
  const pasteEvent = (files: File[]) => {
    const preventDefault = vi.fn();
    const e = {
      preventDefault,
      clipboardData: {
        files: files as unknown as FileList,
        items: [] as unknown as DataTransferItemList,
      },
    } as unknown as React.ClipboardEvent;
    return { e, preventDefault };
  };

  it("stages a pasted screenshot", async () => {
    const { result } = renderHook(() => useImageAttachments());
    const { e } = pasteEvent([img("screenshot.png")]);
    act(() => result.current.handlePaste(e));
    await waitFor(() => expect(result.current.count).toBe(1));
    expect(result.current.attachments).toHaveLength(1);
  });

  it("leaves a text-only paste completely alone", async () => {
    // The important one. Swallowing an ordinary text paste in the composer
    // would be a worse bug than the one M2 fixes, and a far more common action.
    const { result } = renderHook(() => useImageAttachments());
    const { e, preventDefault } = pasteEvent([]);
    act(() => result.current.handlePaste(e));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
  });

  it("preventDefaults only when it actually took an image", async () => {
    const { result } = renderHook(() => useImageAttachments());
    const { e, preventDefault } = pasteEvent([img("a.png")]);
    act(() => result.current.handlePaste(e));
    expect(preventDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.count).toBe(1));
  });

  it("screens a pasted image for people, exactly as a picked one is", async () => {
    // The guardrail must not be reachable-around by a new entry point — that
    // is the second-registration-site footgun 1.1.85 calls out for M3.
    vi.mocked(screenImageForPerson).mockResolvedValueOnce({
      blocked: true,
      degraded: false,
      faceCount: 1,
      message: "Someone is in this photo.",
    });
    const { result } = renderHook(() => useImageAttachments());
    const { e } = pasteEvent([img("me.png")]);
    act(() => result.current.handlePaste(e));
    await waitFor(() => expect(result.current.notice).toBeTruthy());
    expect(result.current.count).toBe(0);
  });

  it("respects the per-turn cap", async () => {
    const { result } = renderHook(() => useImageAttachments());
    const { e } = pasteEvent(Array.from({ length: MAX_IMAGES + 2 }, (_, i) => img(`p${i}.png`)));
    act(() => result.current.handlePaste(e));
    await waitFor(() => expect(result.current.count).toBe(MAX_IMAGES));
    expect(result.current.notice).toMatch(new RegExp(String(MAX_IMAGES)));
  });
});
