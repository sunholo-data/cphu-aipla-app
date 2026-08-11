/** Export a student's written text as a file they keep (1.1.73 M2).
 *
 *  JB, 2026-08-11: *"A text field that the students can edit and then download
 *  as txt/rtf/docx/…"*
 *
 *  **Zero dependencies, three real formats.** Plain text, CommonMark, and
 *  RTF 1.x are all documented public formats we can emit correctly by hand.
 *
 *  **`.docx` is deliberately absent.** OOXML is a ZIP of several XML parts and
 *  needs a ZIP writer; the browser has no honest zero-dep path to one. The
 *  dishonest path — emitting HTML under a `.doc` extension — is rejected on
 *  purpose: it fabricates a format, opens as a security warning in Word and not
 *  at all in Pages, and this is a file a student hands to a teacher. `.rtf`
 *  opens with its formatting intact in Word, Pages, Google Docs and
 *  LibreOffice, which is what "downloadable as docx" actually meant. If real
 *  OOXML turns out to be required, it is a vetted dependency through
 *  `make security-check`, not a trick (design doc, human gate 1).
 */

import { slugify, triggerDownload } from "@/lib/download";

export type ExportFormat = "txt" | "md" | "rtf";

export interface WritingExport {
  /** The writing element's title ("Konklusion"); may be empty. */
  title: string;
  /** The activity's title, for the provenance header. */
  activityTitle: string;
  /** The student's group code, for the provenance header. May be empty. */
  groupCode?: string;
  /** The student's text, verbatim. */
  text: string;
  /** ISO date (YYYY-MM-DD) stamped on the file + its name. */
  date: string;
}

const MIME: Record<ExportFormat, string> = {
  txt: "text/plain;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  // RTF is 7-bit ASCII by construction (see `rtfEscape`), so no charset here.
  rtf: "application/rtf",
};

/** The heading line + attribution shown at the top of every export, so a file
 *  that reaches a teacher's inbox says what it is and whose it is. */
export function provenanceLines(doc: WritingExport): string[] {
  const heading = doc.title.trim() || "Tekst";
  const parts = [doc.activityTitle.trim(), doc.groupCode ? `Gruppe: ${doc.groupCode}` : "", doc.date].filter(Boolean);
  return [heading, parts.join(" · ")];
}

export function toPlainText(doc: WritingExport): string {
  const [heading, sub] = provenanceLines(doc);
  return `${heading}\n${sub}\n${"-".repeat(40)}\n\n${doc.text}\n`;
}

export function toMarkdown(doc: WritingExport): string {
  const [heading, sub] = provenanceLines(doc);
  return `# ${heading}\n\n_${sub}_\n\n${doc.text}\n`;
}

/** Escape one run of text for an RTF body.
 *
 *  RTF is a 7-bit format: `\`, `{` and `}` are control characters, and anything
 *  outside ASCII must be written as `\uN?` where N is the UTF-16 code unit as a
 *  SIGNED 16-bit integer, followed by an ASCII fallback character for readers
 *  that do not understand `\u`. Danish `æ ø å` are the cases that matter, and
 *  getting the signedness wrong is how they turn into mojibake in Word. */
export function rtfEscape(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "{" || ch === "}") out += `\\${ch}`;
    else if (ch === "\n") out += "\\par\n";
    else if (ch === "\r") continue;
    else if (code < 128) out += ch;
    else {
      // Astral characters are two UTF-16 units; emit each so surrogate pairs
      // survive rather than being written as one out-of-range escape.
      for (let i = 0; i < ch.length; i++) {
        const unit = ch.charCodeAt(i);
        out += `\\u${unit > 32767 ? unit - 65536 : unit}?`;
      }
    }
  }
  return out;
}

export function toRtf(doc: WritingExport): string {
  const [heading, sub] = provenanceLines(doc);
  return [
    "{\\rtf1\\ansi\\ansicpg1252\\deff0",
    "{\\fonttbl{\\f0\\froman Times New Roman;}}",
    "\\fs24",
    `{\\b\\fs32 ${rtfEscape(heading)}}\\par`,
    `{\\i ${rtfEscape(sub)}}\\par\\par`,
    `${rtfEscape(doc.text)}\\par`,
    "}",
  ].join("\n");
}

export function serialiseWriting(doc: WritingExport, format: ExportFormat): string {
  if (format === "rtf") return toRtf(doc);
  if (format === "md") return toMarkdown(doc);
  return toPlainText(doc);
}

/** `<aktivitet>-<felt>-<dato>.<ext>` — recognisable in a downloads folder that
 *  already holds thirty files called "document". */
export function exportFilename(doc: WritingExport, format: ExportFormat): string {
  const stem = [slugify(doc.activityTitle), slugify(doc.title), doc.date].filter(Boolean).join("-") || "tekst";
  return `${stem}.${format}`;
}

/** Serialise + download. Entirely client-side: the text is already in the
 *  browser, so there is no server-side file-generation surface to secure and
 *  no second copy of the student's work to retain. */
export function exportWriting(doc: WritingExport, format: ExportFormat): void {
  const blob = new Blob([serialiseWriting(doc, format)], { type: MIME[format] });
  triggerDownload(blob, exportFilename(doc, format));
}
