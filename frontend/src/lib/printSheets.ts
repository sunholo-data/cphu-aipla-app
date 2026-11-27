/** Print rendered activity sheets on their own, one A4 page each (1.1.165).
 *
 *  Printing the app page itself would print the teacher navigation, the banners
 *  and whatever the app shell's scroll box clips. Instead this copies the
 *  sheets' already-rendered HTML (React-escaped, our own DOM) into a small
 *  window with its own print stylesheet and prints that. If the browser
 *  blocks the window, it falls back to printing the page.
 *
 *  The stylesheet mirrors the Word template (`backend/handouts/sheet_template.py`)
 *  so the two printed versions look like the same document.
 */

const PRINT_CSS = `
@page { size: A4; margin: 14mm 20mm 16mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.38; color: #1f1f1f; margin: 0; }
[data-sheet] { break-after: page; }
/* last-of-type, not last-child: the <footer> follows the last sheet. */
[data-sheet]:last-of-type { break-after: auto; }
[data-sheet-header] { display: flex; align-items: center; gap: 8pt; border-bottom: 1.5pt solid #901A1E;
  padding-bottom: 5pt; margin-bottom: 12pt; }
[data-sheet-header] img { width: 42pt; height: 42pt; }
[data-sheet-header] > div { display: flex; flex-direction: column; flex: 1; line-height: 1.15; }
[data-sheet-header] > div > span:first-child { color: #901A1E; font-weight: bold; font-size: 15pt; letter-spacing: 0.5pt; }
[data-sheet-header] > div > span:last-child, [data-sheet-header] > span { color: #6b6b6b; font-size: 8pt; }
[data-sheet-header] > span { text-transform: uppercase; letter-spacing: 1.5pt; }
h1 { color: #901A1E; font-size: 22pt; line-height: 1.1; margin: 0 0 10pt; }
h2 { color: #901A1E; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.6pt; margin: 15pt 0 5pt;
  padding-bottom: 3pt; border-bottom: 0.75pt solid #E2C6C7; break-after: avoid; }
p { margin: 0 0 5pt; }
ul, ol { margin: 0 0 5pt; padding-left: 18pt; }
li { margin: 0 0 3pt; }
table { width: 100%; border-collapse: collapse; background: #F8F1F1; border: 0.5pt solid #E2C6C7; margin: 0 0 6pt; }
td { padding: 4.5pt 8pt; border-bottom: 0.5pt solid #E2C6C7; vertical-align: top; text-align: left; font-weight: normal; }
td:first-child { width: 20%; color: #901A1E; font-weight: bold; }
a { color: inherit; text-decoration: none; }
em { color: #6b6b6b; }
footer { position: fixed; bottom: 0; left: 0; right: 0; border-top: 0.5pt solid #d9d9d9; padding-top: 3pt;
  font-size: 7.5pt; color: #6b6b6b; }
`;

const IMAGE_WAIT_MS = 4000;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

export function printSheets(
  container: HTMLElement | null,
  title: string,
  lang: string,
  footer = "AIPLA · AI in Physics Learning and Assessment",
): void {
  if (!container) return;
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) {
    window.print();
    return;
  }
  // <base> so the seal's root-relative src resolves in the blank window.
  w.document.open();
  w.document.write(
    `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">` +
      `<base href="${escapeHtml(window.location.origin)}/">` +
      `<title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head>` +
      `<body>${container.innerHTML}<footer>${escapeHtml(footer)}</footer></body></html>`,
  );
  w.document.close();
  w.focus();
  // Close once the dialog is done (Safari's print() returns before it is), and
  // print only once the seal has loaded, or after a few seconds regardless.
  w.onafterprint = () => w.close();
  const started = Date.now();
  const tick = () => {
    const loaded = Array.from(w.document.images).every((img) => img.complete);
    if (loaded || Date.now() - started > IMAGE_WAIT_MS) w.print();
    else w.setTimeout(tick, 100);
  };
  w.setTimeout(tick, 100);
}
