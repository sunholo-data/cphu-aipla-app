/**
 * Images on the clipboard — 1.1.85 M2.
 *
 * Teacher feedback 2026-08-21, item 8: *"pasting a screenshot directly from the
 * clipboard without saving it as a file first would be much easier."*
 *
 * The `items` fallback carries most of these tests. Reading only `files` works
 * on Chrome and silently does nothing on browsers that expose a pasted
 * screenshot through `items` — and "silently does nothing" is indistinguishable,
 * from the student's side, from the feature not existing.
 */

import { describe, expect, it } from "vitest";

import { imageFilesFromClipboard } from "../clipboardImages";

const file = (name: string, type: string, size = 10) => {
  const f = new File([new Uint8Array(size)], name, { type });
  return f;
};

/** Minimal DataTransfer stand-in — jsdom does not construct a real one with
 *  files, and the shapes below are exactly what browsers hand us. */
function dt({
  files = [] as File[],
  items = [] as { kind: string; type: string; file?: File }[],
}): DataTransfer {
  return {
    files: files as unknown as FileList,
    items: items.map((i) => ({
      kind: i.kind,
      type: i.type,
      getAsFile: () => i.file ?? null,
    })) as unknown as DataTransferItemList,
  } as DataTransfer;
}

describe("imageFilesFromClipboard", () => {
  it("reads an image from `files`", () => {
    const png = file("screenshot.png", "image/png");
    expect(imageFilesFromClipboard(dt({ files: [png] }))).toEqual([png]);
  });

  it("reads an image from `items` when `files` is empty", () => {
    // Safari's historic shape. Reading only `files` here returns nothing and
    // the paste appears to do nothing at all.
    const png = file("screenshot.png", "image/png");
    expect(imageFilesFromClipboard(dt({ items: [{ kind: "file", type: "image/png", file: png }] }))).toEqual([png]);
  });

  it("does not stage the same image twice when it appears in both", () => {
    // Burning two of the four attachment slots on one screenshot.
    const png = file("screenshot.png", "image/png");
    const out = imageFilesFromClipboard(
      dt({ files: [png], items: [{ kind: "file", type: "image/png", file: png }] }),
    );
    expect(out).toHaveLength(1);
  });

  it("ignores a text-only paste", () => {
    // The caller's signal to leave the event alone so ordinary paste works.
    expect(imageFilesFromClipboard(dt({ items: [{ kind: "string", type: "text/plain" }] }))).toEqual([]);
  });

  it("ignores a non-image file", () => {
    expect(imageFilesFromClipboard(dt({ files: [file("notes.pdf", "application/pdf")] }))).toEqual([]);
  });

  it("ignores an items entry whose getAsFile returns null", () => {
    // Real browsers do this for a string item mislabelled as a file.
    expect(imageFilesFromClipboard(dt({ items: [{ kind: "file", type: "image/png" }] }))).toEqual([]);
  });

  it("survives a missing or empty payload", () => {
    expect(imageFilesFromClipboard(null)).toEqual([]);
    expect(imageFilesFromClipboard(undefined)).toEqual([]);
    expect(imageFilesFromClipboard(dt({}))).toEqual([]);
  });

  it("keeps several distinct images", () => {
    const a = file("a.png", "image/png");
    const b = file("b.jpg", "image/jpeg", 20);
    expect(imageFilesFromClipboard(dt({ files: [a, b] }))).toHaveLength(2);
  });
});
