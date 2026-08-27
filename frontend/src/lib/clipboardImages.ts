/**
 * Images on the clipboard — 1.1.85 M2.
 *
 * Teacher feedback 2026-08-21, item 8:
 *
 *   "Pasting a screenshot directly from the clipboard without saving it as a
 *   file first would be much easier."
 *
 * Nothing in the frontend handled a paste at all before this — no `onPaste`
 * anywhere — so a screenshot, the single most natural thing a student has to
 * show, had to be saved to disk and then browsed for.
 */

/** Identity for dedupe. A pasted screenshot can appear in BOTH `files` and
 *  `items`, and staging it twice would burn two of the four attachment slots
 *  on one image. */
function key(f: File): string {
  return `${f.name}:${f.size}:${f.type}:${f.lastModified}`;
}

/**
 * Every image file on a paste/drop payload, deduplicated.
 *
 * Reads both `files` and `items` because they are not interchangeable: `files`
 * is the modern path, and Safari has historically exposed a pasted screenshot
 * only through `items`. Reading one alone silently does nothing on some
 * browsers — which is indistinguishable, to the student, from the feature not
 * existing.
 *
 * Returns `[]` for a text-only paste, which is the caller's signal to leave the
 * event alone so ordinary text paste still works.
 */
export function imageFilesFromClipboard(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const out: File[] = [];
  const seen = new Set<string>();

  for (const f of Array.from(data.files ?? [])) {
    if (!f.type.startsWith("image/")) continue;
    const k = key(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const f = item.getAsFile();
    if (!f) continue;
    const k = key(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }

  return out;
}
