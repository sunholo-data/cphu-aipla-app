/**
 * Upload-outcome beacon (2026-11-09).
 *
 * WHY: at the Bohr workshop on 3 Nov, teachers reported that a photo "didn't
 * upload from the phone" and "didn't show". The server logs could only say what
 * ARRIVED (four groups' photos did, and the tutor described them). Everything
 * that decides whether a photo is sent happens in the browser, before any
 * request: the on-device person screen can BLOCK a photo of students (that
 * activity was an embodied model, with students acting as proton and electron),
 * the downscale can fall back to sending the original, the cap can refuse a
 * fifth image, and a file with an empty MIME type was dropped with no notice at
 * all. None of those is an exception, so the client-error reporter never saw
 * them. This records each one.
 *
 * Same contract as `clientEnvBeacon` (`kind: "env"`): the client-errors
 * endpoint, its own log id (`aipla_client_upload`), closed enums only, and **no
 * identity** — no uid, group code, file name, path or user agent. A size bucket
 * and a MIME family are fine; a file name is not (it can be a person's name).
 * Never throws; stops for the page on any non-2xx.
 *
 * Read them with `make upload-outcomes ENV=prod`.
 */

import { CLIENT_ERROR_ENDPOINT } from "@/lib/clientErrorReporting";
import { isLocalMode } from "@/lib/localMode";
import { clientBuildId } from "@/lib/staleDeployReload";

/** What happened to one picked file. Mirrors UPLOAD_OUTCOMES in client_error.py. */
export type UploadOutcome =
  | "staged" // ready to send
  | "blocked_person" // the on-device screen found a face; refused, retake asked
  | "too_many" // over MAX_IMAGES for one turn
  | "not_image" // not an image by type or extension; refused
  | "process_failed"; // could not be read at all

/** How a staged image was encoded. Mirrors UPLOAD_ENCODINGS. */
export type UploadEncoding = "resized" | "original_type" | "original_error";

/** The person screen's verdict. Mirrors UPLOAD_SCREENS. */
export type UploadScreen = "clean" | "degraded" | "blocked";

/** Which control the file came through. Mirrors UPLOAD_WHERE. */
export type UploadWhere = "chat" | "solution";

export interface UploadOutcomePayload {
  kind: "upload";
  outcome: UploadOutcome;
  where: UploadWhere;
  mime: string;
  sizeKb: number;
  encodedKb: number | null;
  encoding: UploadEncoding | null;
  screen: UploadScreen | null;
  pointer: "coarse" | "fine";
  buildId: string | null;
}

const MIME_FAMILIES = new Set(["jpeg", "png", "webp", "heic", "heif", "gif"]);

/** The MIME family only: `image/jpeg` → `jpeg`, `""` → `empty`, else `other`. */
export function mimeFamily(type: string): string {
  if (!type) return "empty";
  const sub = type.toLowerCase().replace(/^image\//, "");
  return MIME_FAMILIES.has(sub) ? sub : "other";
}

/** Base64 length → kilobytes of the bytes it encodes. */
export function base64Kb(data: string): number {
  return Math.round((data.length * 3) / 4 / 1024);
}

let stopped = false;

/** Test-only: forget this page load's state. */
export function resetUploadBeaconForTests(): void {
  stopped = false;
}

export interface UploadOutcomeInput {
  outcome: UploadOutcome;
  where: UploadWhere;
  file: { type: string; size: number };
  encodedKb?: number | null;
  encoding?: UploadEncoding | null;
  screen?: UploadScreen | null;
}

/** Build the wire payload. Exported for tests; it carries nothing else. */
export function buildUploadOutcome(input: UploadOutcomeInput): UploadOutcomePayload {
  let coarse = false;
  try {
    coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    // Not worth losing the report over.
  }
  return {
    kind: "upload",
    outcome: input.outcome,
    where: input.where,
    mime: mimeFamily(input.file.type),
    sizeKb: Math.round(input.file.size / 1024),
    encodedKb: input.encodedKb ?? null,
    encoding: input.encoding ?? null,
    screen: input.screen ?? null,
    pointer: coarse ? "coarse" : "fine",
    buildId: clientBuildId(),
  };
}

/** Report one upload outcome. Never throws, never blocks the upload. */
export function reportUploadOutcome(input: UploadOutcomeInput): void {
  try {
    if (typeof window === "undefined" || isLocalMode() || stopped) return;
    const body = buildUploadOutcome(input);
    void fetch(CLIENT_ERROR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) stopped = true;
      })
      .catch(() => {
        stopped = true;
      });
  } catch {
    // Telemetry must never break an upload.
  }
}
