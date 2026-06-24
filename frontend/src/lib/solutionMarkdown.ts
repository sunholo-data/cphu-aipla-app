/**
 * Solution-editor serialisation (1.1.45 M4). The TipTap rich-text editor's
 * source of truth is its ProseMirror JSON doc (persisted for draft reload, no
 * markdown→TipTap parser needed). When the student submits, the doc is
 * serialised to **markdown (+ `$…$` KaTeX math)** — the form the tutor reads and
 * `ChatMarkdown` re-renders (remark-math/rehype-katex, `$…$` inline / `$$…$$`
 * block, the same delimiters the chat already uses).
 *
 * Bounded to the nodes/marks the JB-2 toolbar produces; unknown nodes degrade to
 * their inline text (never throws on an unexpected doc). Underline has no
 * markdown form `ChatMarkdown` renders (no rehype-raw), so it carries through as
 * plain text — it's cosmetic and the tutor needs the words, not the underline.
 */

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

/** Serialise a TipTap/ProseMirror doc to markdown for the tutor. */
export function solutionDocToMarkdown(doc: PMNode | null | undefined): string {
  if (!doc?.content) return "";
  return doc.content
    .map((n) => serializeBlock(n, 0))
    .filter((s) => s.length > 0)
    .join("\n\n")
    .trim();
}

function serializeBlock(node: PMNode, depth: number): string {
  switch (node.type) {
    case "paragraph":
      return serializeInline(node.content);
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `${"#".repeat(level)} ${serializeInline(node.content)}`;
    }
    case "bulletList":
      return serializeList(node, null, depth);
    case "orderedList":
      return serializeList(node, Number(node.attrs?.start ?? 1), depth);
    case "blockMath":
      return `$$${String(node.attrs?.latex ?? "")}$$`;
    case "image":
      return imageMd(node);
    case "codeBlock":
      return `\`\`\`\n${serializeInline(node.content)}\n\`\`\``;
    case "blockquote":
      return (node.content ?? [])
        .map((c) => serializeBlock(c, depth))
        .join("\n")
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    case "horizontalRule":
      return "---";
    default:
      return serializeInline(node.content);
  }
}

function serializeList(node: PMNode, start: number | null, depth: number): string {
  const indent = "  ".repeat(depth);
  return (node.content ?? [])
    .map((item, i) => {
      const marker = start === null ? "- " : `${start + i}. `;
      // A listItem holds block children (usually one paragraph). Keep the marker
      // on the first line; nested lists indent under it.
      const inner = (item.content ?? [])
        .map((c) => serializeBlock(c, depth + 1))
        .join("\n");
      return `${indent}${marker}${inner}`;
    })
    .join("\n");
}

function serializeInline(content?: PMNode[]): string {
  if (!content) return "";
  return content.map(serializeNode).join("");
}

function serializeNode(node: PMNode): string {
  if (node.type === "inlineMath") return `$${String(node.attrs?.latex ?? "")}$`;
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "image") return imageMd(node);
  if (node.type !== "text") return serializeInline(node.content);

  let text = node.text ?? "";
  const marks = node.marks ?? [];
  const has = (t: string) => marks.some((m) => m.type === t);

  // Inline code excludes other formatting (markdown semantics).
  if (has("code")) return `\`${text}\``;
  if (has("bold")) text = `**${text}**`;
  if (has("italic")) text = `*${text}*`;
  const link = marks.find((m) => m.type === "link");
  const href = link?.attrs?.href;
  if (typeof href === "string" && href) text = `[${text}](${href})`;
  return text;
}

function imageMd(node: PMNode): string {
  const src = String(node.attrs?.src ?? "");
  const alt = String(node.attrs?.alt ?? "");
  return `![${alt}](${src})`;
}

/** Word count over the doc's plain text (toolbar/footer display). */
export function solutionWordCount(doc: PMNode | null | undefined): number {
  const text = plainText(doc).trim();
  return text ? text.split(/\s+/).length : 0;
}

function plainText(node: PMNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "inlineMath" || node.type === "blockMath") return String(node.attrs?.latex ?? "");
  return (node.content ?? []).map(plainText).join(node.type === "doc" ? " " : "");
}
