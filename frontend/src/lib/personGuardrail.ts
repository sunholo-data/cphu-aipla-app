/**
 * On-device "no recognizable person" guardrail for image upload (1.1.21,
 * from the 9-June teacher feedback).
 *
 * Students shouldn't be sending photos of classmates' faces to the model.
 * We screen each image *on-device* with the Shape Detection API's
 * `FaceDetector` before it ever leaves the browser — no bytes, no network.
 * If a face is found we block the upload and ask for a retake.
 *
 * Crucially this DEGRADES GRACEFULLY: `FaceDetector` ships in Chromium behind
 * a flag and isn't in Firefox/Safari. When it's unavailable we DO NOT block
 * (over-blocking every upload on Safari would kill the feature) — we surface a
 * soft notice instead and let the upload through. The decision core is a pure
 * function so this policy is unit-testable without the real browser API.
 */

export interface PersonScreenResult {
  /** true => refuse this image, prompt a retake. */
  blocked: boolean;
  /** true => detector wasn't available; we allowed the image with a notice. */
  degraded: boolean;
  /** how many faces the detector reported (0 when degraded/none). */
  faceCount: number;
  /** user-facing line for the blocked/degraded case; null when clean. */
  message: string | null;
}

export const RETAKE_MESSAGE =
  "That photo looks like it has a person in it. Please retake it without people in frame before sending.";

export const DEGRADED_NOTICE =
  "Heads up: this device can't auto-check photos for people. Please make sure there are no classmates in shot before sending.";

/**
 * Pure decision core: given the face count and whether detection ran, decide
 * whether to block. Kept separate from the browser API so it's directly
 * testable.
 */
export function evaluatePersonScreen(
  faceCount: number,
  detectorAvailable: boolean,
): PersonScreenResult {
  if (!detectorAvailable) {
    return { blocked: false, degraded: true, faceCount: 0, message: DEGRADED_NOTICE };
  }
  if (faceCount > 0) {
    return { blocked: true, degraded: false, faceCount, message: RETAKE_MESSAGE };
  }
  return { blocked: false, degraded: false, faceCount: 0, message: null };
}

/** Minimal structural type for the Shape Detection API FaceDetector. */
interface FaceDetectorLike {
  detect(source: CanvasImageSource | Blob): Promise<Array<unknown>>;
}
interface FaceDetectorCtor {
  new (opts?: { maxDetectedFaces?: number; fastMode?: boolean }): FaceDetectorLike;
}

/** True when the on-device FaceDetector is usable in this environment. */
export function isFaceDetectionAvailable(): boolean {
  return typeof (globalThis as { FaceDetector?: unknown }).FaceDetector === "function";
}

/**
 * Screen an image File for people on-device. Never throws — a detector error
 * is treated as "degraded" (allow + notice), not "block", so a flaky API can't
 * silently swallow uploads.
 *
 * `detectorFactory` is injectable for tests; in the browser it defaults to the
 * global `FaceDetector`.
 */
export async function screenImageForPerson(
  file: Blob,
  detectorFactory?: () => FaceDetectorLike | null,
): Promise<PersonScreenResult> {
  const factory =
    detectorFactory ??
    (() => {
      const Ctor = (globalThis as { FaceDetector?: FaceDetectorCtor }).FaceDetector;
      return Ctor ? new Ctor({ fastMode: true }) : null;
    });

  let detector: FaceDetectorLike | null;
  try {
    detector = factory();
  } catch {
    detector = null;
  }
  if (!detector) {
    return evaluatePersonScreen(0, false);
  }

  try {
    const bitmap = await createImageBitmap(file);
    let faces: Array<unknown>;
    try {
      faces = await detector.detect(bitmap as unknown as CanvasImageSource);
    } finally {
      // ImageBitmap holds decoded pixels; release them promptly.
      (bitmap as unknown as { close?: () => void }).close?.();
    }
    return evaluatePersonScreen(faces.length, true);
  } catch {
    // Decode/detect failure => degrade (allow + notice), don't hard-block.
    return evaluatePersonScreen(0, false);
  }
}
