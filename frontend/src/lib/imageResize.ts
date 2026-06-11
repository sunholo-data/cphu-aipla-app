/**
 * Client-side image downscale for multimodal upload (1.1.7).
 *
 * Student/teacher photos go to Gemini vision as inline base64 on
 * `forwardedProps.attachments`. We resize on-device to a sane longest-edge
 * before encoding so we don't ship 12-megapixel phone photos over SSE — it
 * cuts payload ~10-20x and keeps the turn snappy without hurting the model's
 * read of a physics worksheet or whiteboard.
 *
 * The canvas/Image work only runs in a browser. The size math and data-URL
 * handling are split out as pure functions so they're unit-testable under
 * jsdom (which has no real 2D canvas).
 */

export interface EncodedImage {
  mimeType: string;
  /** base64 WITHOUT the `data:...;base64,` prefix — matches the backend's Blob(data=base64). */
  data: string;
  name?: string;
}

/** Longest-edge target. 2048px is plenty for the model to read text/diagrams. */
export const MAX_EDGE = 2048;

/** JPEG quality used when re-encoding a downscaled raster. */
export const JPEG_QUALITY = 0.85;

/**
 * Mimes the browser canvas can reliably decode + re-encode. HEIC/HEIF are
 * NOT here: Chrome can't decode them in a canvas, so they pass through raw
 * (Gemini accepts heic/heif directly).
 */
const CANVAS_DECODABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Scale (w,h) so the longest edge is at most `maxEdge`, preserving aspect.
 * Never upscales. Returns integer dimensions (>=1).
 */
export function computeTargetSize(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Strip the `data:<mime>;base64,` prefix from a data URL, leaving raw base64. */
export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Read a File/Blob as raw base64 (no data-URL prefix). Browser-only. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => resolve(stripDataUrlPrefix(String(reader.result ?? "")));
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale an image File to <= MAX_EDGE on its longest edge and return base64.
 * Browser-only (needs Image + canvas).
 *
 * - Canvas-decodable rasters (jpeg/png/webp) are drawn to a downscaled canvas
 *   and re-encoded as JPEG (q=0.85). Transparency is flattened to white — fine
 *   for photos/scans, which is the whole use case.
 * - Anything else (e.g. heic) passes through as raw base64 with its original
 *   mime; the model handles the decode.
 * - If decode fails for any reason, falls back to raw passthrough rather than
 *   dropping the attachment.
 */
export async function resizeImageFile(
  file: File,
  maxEdge: number = MAX_EDGE,
): Promise<EncodedImage> {
  const passthrough = async (): Promise<EncodedImage> => ({
    mimeType: file.type || "application/octet-stream",
    data: await fileToBase64(file),
    name: file.name,
  });

  if (!CANVAS_DECODABLE.has(file.type)) {
    return passthrough();
  }

  let url: string | null = null;
  try {
    url = URL.createObjectURL(file);
    const img = await loadImage(url);
    const target = computeTargetSize(img.naturalWidth, img.naturalHeight, maxEdge);

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return passthrough();
    // Flatten transparency to white so PNG screenshots don't read as black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(img, 0, 0, target.width, target.height);

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return { mimeType: "image/jpeg", data: stripDataUrlPrefix(dataUrl), name: file.name };
  } catch {
    return passthrough();
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}
