/**
 * "Gem som noter" — the text half (1.1.151 F6).
 *
 * A student asks the tutor to summarise the conversation "så jeg kan gemme dem
 * som noter", then presses *Gem som noter* on that reply. These are the pure
 * pieces: turning a tutor reply into plain prose for a `<textarea>`, and
 * appending it to what the student already wrote — never replacing it.
 *
 * The student's writing stays the student's (Axiom 2): the tutor has no write
 * path into the document; only the student's own click moves text there, and
 * the heading says where it came from.
 */

/** Tutor Markdown → plain prose the writing surface can hold.
 *
 *  The writing element is a plain `<textarea>` (1.1.73), so Markdown syntax
 *  would sit in the student's notes as literal asterisks. Links keep their
 *  label (an `aitana://` target means nothing outside the chat), emphasis and
 *  heading markers go, list bullets become "- ". Maths is left as written:
 *  `$v = s/t$` is still readable, and guessing a Unicode rendering would be
 *  worse than the source. */
export function notesToPlainText(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, "\n");
  // Images first (their syntax contains a link), then links → label.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Headings: "## Opsummering" → "Opsummering".
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  // Bullets: "* x" / "+ x" → "- x" (an asterisk bullet would read as emphasis).
  text = text.replace(/^([ \t]*)[*+][ \t]+/gm, "$1- ");
  // Bold / italic markers (asterisk or underscore runs around a word).
  text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
  text = text.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, "$1$2");
  // Inline code fences keep their content.
  text = text.replace(/`([^`\n]+)`/g, "$1");
  // Collapse runs of blank lines left behind.
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** Append a tutor summary to the student's existing text under a heading.
 *
 *  The student's text is kept byte for byte up to its trailing whitespace; the
 *  notes always land AFTER it. An empty document gets the heading first. */
export function appendTutorNotes(existing: string, heading: string, notes: string): string {
  const block = `${heading}\n${notes.trim()}`;
  const kept = existing.replace(/\s+$/, "");
  return kept ? `${kept}\n\n${block}` : block;
}

/** "08.10.2026 14:32" — a timestamp for the heading that reads the same in
 *  Danish and English and does not depend on the browser's locale (the
 *  language is chosen, never `navigator.language`). */
export function formatNotesTimestamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()} ${p(date.getHours())}:${p(date.getMinutes())}`;
}
