/**
 * Tutor-output maths repairs, applied by ChatMarkdown before remark-math runs
 * (1.1.147 M0 — docs/design/aipla/v1.1.0-feedback/seminar-chat-surface-fixes.md).
 *
 * Prod, 2026-10-05: of 234 tutor turns, 15 wrapped maths in backticks
 * (`` `$E = P \cdot t$` ``) — Markdown parses a code span BEFORE remark-math
 * sees it, so the student read the source in monospace, dollars and all — and 3
 * put `^\circ` or `\celsius` inside `\text{…}`, which KaTeX rejects. Students
 * asked the tutor what "cdot" meant.
 *
 * The fix lives in the renderer because only the renderer knows where code
 * is: a fenced block is never touched, and a code span is touched only when
 * its ENTIRE content is one maths expression. Not a general LaTeX fixer — each
 * text-mode repair is an observed prod shape with its example in the tests.
 *
 * Pure string functions; no React, no DOM.
 */

type SegmentKind = "text" | "fence" | "code" | "lone-ticks";

interface Segment {
  kind: SegmentKind;
  raw: string;
}

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Split into fenced code blocks (``` or ~~~, line-based) and the rest. An
 *  unclosed fence runs to the end of the text, as in CommonMark. */
function splitFences(text: string): Segment[] {
  const out: Segment[] = [];
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));

  let buf = "";
  let fence: { char: string; len: number } | null = null;
  for (const line of lines) {
    if (!fence) {
      const m = line.match(FENCE_OPEN_RE);
      // A backtick fence's info string may not contain a backtick.
      if (m && !(m[1][0] === "`" && line.slice(m[0].length).includes("`"))) {
        if (buf) out.push({ kind: "text", raw: buf });
        buf = line;
        fence = { char: m[1][0], len: m[1].length };
      } else {
        buf += line;
      }
    } else {
      buf += line;
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
        out.push({ kind: "fence", raw: buf });
        buf = "";
        fence = null;
      }
    }
  }
  if (buf) out.push({ kind: fence ? "fence" : "text", raw: buf });
  return out;
}

/** Split a non-fence chunk into inline code spans and text. A backtick run
 *  closes only on a run of EXACTLY the same length (CommonMark); a run with no
 *  closer is literal — kept as `lone-ticks` so the streaming guard can see it. */
function splitCodeSpans(chunk: string): Segment[] {
  const out: Segment[] = [];
  let text = "";
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i];
    if (ch === "\\" && i + 1 < chunk.length) {
      text += chunk.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== "`") {
      text += ch;
      i++;
      continue;
    }
    let n = 0;
    while (chunk[i + n] === "`") n++;
    // Find the next run of exactly n backticks.
    let j = i + n;
    let close = -1;
    while (j < chunk.length) {
      if (chunk[j] === "`") {
        let m = 0;
        while (chunk[j + m] === "`") m++;
        if (m === n) {
          close = j;
          break;
        }
        j += m;
      } else {
        j++;
      }
    }
    if (close === -1) {
      if (text) out.push({ kind: "text", raw: text });
      text = "";
      out.push({ kind: "lone-ticks", raw: chunk.slice(i, i + n) });
      i += n;
      continue;
    }
    if (text) out.push({ kind: "text", raw: text });
    text = "";
    out.push({ kind: "code", raw: chunk.slice(i, close + n) });
    i = close + n;
  }
  if (text) out.push({ kind: "text", raw: text });
  return out;
}

function segment(text: string): Segment[] {
  return splitFences(text).flatMap((s) => (s.kind === "fence" ? [s] : splitCodeSpans(s.raw)));
}

function mapSegments(text: string, fn: (s: Segment) => string): string {
  return segment(text).map(fn).join("");
}

// ── 1. unwrapCodedMath ───────────────────────────────────────────────────

const WHOLE_DISPLAY_RE = /^\$\$([^$]+)\$\$$/;
const WHOLE_INLINE_RE = /^\$([^$]+)\$$/;
const WHOLE_PAREN_RE = /^\\\(([\s\S]+?)\\\)$/;
const WHOLE_BRACKET_RE = /^\\\[([\s\S]+?)\\\]$/;

/**
 * An inline code span whose ENTIRE content is one maths expression loses its
 * backticks: `` `$…$` `` → `$…$`, `` `$$…$$` `` → `$$…$$`, `` `\(…\)` `` →
 * `$…$`, `` `\[…\]` `` → `$$…$$`. `` `price = $5` ``, `` `\cdot` `` or any span
 * with text outside the delimiters is untouched; so is every fenced block.
 */
export function unwrapCodedMath(text: string): string {
  if (!text.includes("`")) return text;
  return mapSegments(text, (s) => {
    if (s.kind !== "code") return s.raw;
    let n = 0;
    while (s.raw[n] === "`") n++;
    const inner = s.raw.slice(n, s.raw.length - n);
    // A backtick inside a multi-backtick span: too ambiguous to be worth a rule.
    if (inner.includes("`")) return s.raw;
    const body = inner.trim();
    let m = body.match(WHOLE_DISPLAY_RE);
    if (m && m[1].trim()) return `$$${m[1]}$$`;
    m = body.match(WHOLE_INLINE_RE);
    if (m && m[1].trim()) return `$${m[1]}$`;
    m = body.match(WHOLE_PAREN_RE);
    if (m && m[1].trim() && !m[1].includes("\\)")) return `$${m[1]}$`;
    m = body.match(WHOLE_BRACKET_RE);
    if (m && m[1].trim() && !m[1].includes("\\]")) return `$$${m[1]}$$`;
    return s.raw;
  });
}

// ── 2. normalizeMathDelimiters ───────────────────────────────────────────

// Neither may cross a blank line: a paragraph break means the closer belongs
// to something else.
const PAREN_RE = /\\\(((?:(?!\n\s*\n)[\s\S])+?)\\\)/g;
const BRACKET_RE = /\\\[((?:(?!\n\s*\n)[\s\S])+?)\\\]/g;

/**
 * `\(…\)` → `$…$`, `\[…\]` → `$$…$$`. Without this, Markdown consumes the
 * escaping backslash and the student reads `(v = \frac{s}{t})`. A `\[…\]` that
 * stands on its own line(s) becomes a display block; one mid-sentence stays
 * inline. Fences and code spans are left alone.
 */
export function normalizeMathDelimiters(text: string): string {
  if (!text.includes("\\(") && !text.includes("\\[")) return text;
  return mapSegments(text, (s) => {
    if (s.kind !== "text") return s.raw;
    return s.raw
      .replace(BRACKET_RE, (match, inner: string, offset: number, whole: string) => {
        const before = whole.slice(0, offset);
        const after = whole.slice(offset + match.length);
        const ownLine = /(^|\n)[ \t]*$/.test(before) && /^[ \t]*(\n|$)/.test(after);
        return ownLine ? `\n\n$$\n${inner.trim()}\n$$\n\n` :`$$${inner.trim()}$$`;
      })
      .replace(PAREN_RE, (_m, inner: string) => `$${inner.trim()}$`);
  });
}

// ── 3. repairTextModeMaths ───────────────────────────────────────────────

const DEGREE = String.raw`(?:\^\s*(?:\\circ|\{\s*\\circ\s*\}|°)|\\degree|°)`;
// `\text{ ^\circ C}` / `\text{^{\circ}C}` / `\text{ \degree C}` — `^` is not
// allowed in text mode, so KaTeX rejects the first two outright.
const TEXT_DEGREE_RE = new RegExp(String.raw`\\text\{\s*${DEGREE}\s*([CFK]?)\s*\}`, "g");
// `\text{ \celsius}` — siunitx, not KaTeX.
const TEXT_CELSIUS_RE = /\\text\{\s*\\celsius\s*\}/g;
const BARE_CELSIUS_RE = /\\celsius(?![A-Za-z])/g;
const MATH_REGION_RE = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g;

function repairOne(math: string): string {
  return math
    .replace(TEXT_DEGREE_RE, (_m, unit: string) => (unit ? `^\\circ\\text{${unit}}` : "^\\circ"))
    .replace(TEXT_CELSIUS_RE, "^\\circ\\text{C}")
    .replace(BARE_CELSIUS_RE, "^\\circ\\text{C}");
}

/**
 * Inside `$…$` / `$$…$$` only, the two text-mode shapes seen on 2026-10-05:
 * a degree sign inside `\text{…}` → `^\circ\text{C}`, and `\celsius` →
 * `^\circ\text{C}`. Correct maths is returned unchanged.
 */
export function repairTextModeMaths(text: string): string {
  if (!text.includes("\\text") && !text.includes("\\celsius")) return text;
  return mapSegments(text, (s) => (s.kind === "text" ? s.raw.replace(MATH_REGION_RE, repairOne) : s.raw));
}

/** The three repairs, in the order the design fixes. */
export function prepareChatMaths(text: string): string {
  return repairTextModeMaths(normalizeMathDelimiters(unwrapCodedMath(text)));
}

// ── Streaming tail guard ─────────────────────────────────────────────────

/**
 * While a turn streams, hold back everything from an unclosed `$`, `$$`,
 * `\(`, `\[` or backtick run at the tail, so the student never sees maths
 * source or a half code span flash before its closer arrives. A trailing lone
 * backslash is held too (it may be the start of `\(`). Fenced blocks are
 * passed through: streaming code is still code.
 */
export function holdOpenMath(text: string): string {
  let offset = 0;
  for (const s of segment(text)) {
    if (s.kind === "lone-ticks") return text.slice(0, offset);
    if (s.kind === "text") {
      const cut = openMathAt(s.raw);
      if (cut !== -1) return text.slice(0, offset + cut);
    }
    offset += s.raw.length;
  }
  return text;
}

/** Index of the first unclosed maths opener in a text chunk, or -1. */
function openMathAt(raw: string): number {
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith("\\(", i) || raw.startsWith("\\[", i)) {
      const closer = raw[i + 1] === "(" ? "\\)" : "\\]";
      const close = raw.indexOf(closer, i + 2);
      if (close === -1) return i;
      i = close + 2;
      continue;
    }
    if (raw[i] === "\\") {
      if (i === raw.length - 1) return i;
      i += 2;
      continue;
    }
    if (raw.startsWith("$$", i)) {
      const close = raw.indexOf("$$", i + 2);
      if (close === -1) return i;
      i = close + 2;
      continue;
    }
    if (raw[i] === "$") {
      const close = raw.indexOf("$", i + 1);
      if (close === -1) return i;
      i = close + 1;
      continue;
    }
    i++;
  }
  return -1;
}
