import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEGRADED_NOTICE,
  RETAKE_MESSAGE,
  evaluatePersonScreen,
  isFaceDetectionAvailable,
  screenImageForPerson,
} from "../personGuardrail";

describe("evaluatePersonScreen (pure decision core)", () => {
  it("blocks when the detector is available and a face is present", () => {
    const r = evaluatePersonScreen(1, true);
    expect(r.blocked).toBe(true);
    expect(r.degraded).toBe(false);
    expect(r.message).toBe(RETAKE_MESSAGE);
  });

  it("allows a clean image with no message", () => {
    const r = evaluatePersonScreen(0, true);
    expect(r.blocked).toBe(false);
    expect(r.degraded).toBe(false);
    expect(r.message).toBeNull();
  });

  it("degrades (allows + notice) when the detector is unavailable — no over-block", () => {
    const r = evaluatePersonScreen(0, false);
    expect(r.blocked).toBe(false);
    expect(r.degraded).toBe(true);
    expect(r.message).toBe(DEGRADED_NOTICE);
  });
});

describe("isFaceDetectionAvailable", () => {
  afterEach(() => {
    delete (globalThis as { FaceDetector?: unknown }).FaceDetector;
    vi.restoreAllMocks();
  });

  it("is false when FaceDetector is absent", () => {
    expect(isFaceDetectionAvailable()).toBe(false);
  });

  it("is true when FaceDetector exists", () => {
    (globalThis as { FaceDetector?: unknown }).FaceDetector = function () {};
    expect(isFaceDetectionAvailable()).toBe(true);
  });
});

describe("screenImageForPerson", () => {
  const fakeBlob = new Blob(["x"], { type: "image/jpeg" });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error cleanup injected global
    delete globalThis.createImageBitmap;
  });

  it("blocks when the injected detector reports a face", async () => {
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    const detector = { detect: vi.fn().mockResolvedValue([{ boundingBox: {} }]) };
    const r = await screenImageForPerson(fakeBlob, () => detector);
    expect(r.blocked).toBe(true);
    expect(detector.detect).toHaveBeenCalledOnce();
  });

  it("allows when the injected detector reports no faces", async () => {
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    const detector = { detect: vi.fn().mockResolvedValue([]) };
    const r = await screenImageForPerson(fakeBlob, () => detector);
    expect(r.blocked).toBe(false);
    expect(r.degraded).toBe(false);
  });

  it("degrades (no block) when no detector is available", async () => {
    const r = await screenImageForPerson(fakeBlob, () => null);
    expect(r.blocked).toBe(false);
    expect(r.degraded).toBe(true);
  });

  it("degrades rather than throwing when detect() rejects", async () => {
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    const detector = { detect: vi.fn().mockRejectedValue(new Error("boom")) };
    const r = await screenImageForPerson(fakeBlob, () => detector);
    expect(r.blocked).toBe(false);
    expect(r.degraded).toBe(true);
  });
});
