/** Print rendered activity sheets on their own, one A4 page each (1.1.165).
 *
 *  Printing the app page itself would print the teacher navigation, the banners
 *  and whatever the app shell's scroll box clips. Instead this copies the
 *  sheets' already-rendered HTML (React-escaped, our own DOM) into a small
 *  window with its own print stylesheet and prints that. If the browser
 *  blocks the window, it falls back to printing the page.
 */

const PRINT_CSS = `
@page { size: A4; margin: 18mm 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.35; color: #111; margin: 0; }
[data-sheet] { break-after: page; }
[data-sheet]:last-child { break-after: auto; }
h1 { color: #901A1E; font-size: 18pt; margin: 0 0 6pt; }
h2 { color: #901A1E; font-size: 13pt; margin: 14pt 0 4pt; padding-bottom: 2pt; border-bottom: 0.75pt solid #901A1E; break-after: avoid; }
p { margin: 0 0 5pt; }
ul, ol { margin: 0 0 5pt; padding-left: 18pt; }
li { margin: 0 0 2pt; }
a { color: inherit; text-decoration: none; }
em { color: #444; }
footer { position: fixed; bottom: 0; font-size: 8pt; color: #666; }
`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

export function printSheets(container: HTMLElement | null, title: string, lang: string): void {
  if (!container) return;
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) {
    window.print();
    return;
  }
  w.document.open();
  w.document.write(
    `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">` +
      `<title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head>` +
      `<body>${container.innerHTML}<footer>AIPLA · Københavns Universitet</footer></body></html>`,
  );
  w.document.close();
  w.focus();
  // Close once the dialog is done (Safari's print() returns before it is), and
  // give layout a moment before the dialog opens.
  w.onafterprint = () => w.close();
  w.setTimeout(() => w.print(), 150);
}
