"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
// KaTeX CSS — required for rehype-katex's output to render. Imported
// inside ChatMarkdown so pages that don't render chat don't pay the
// ~30KB stylesheet (Next bundles per-route).
import "katex/dist/katex.min.css";
import { InlineCitation } from "@/components/chat/InlineCitation";
import {
  SVGBlock,
  SvgStreamingPlaceholder,
} from "@/components/chat/media/SVGBlock";
import { InlineImage } from "@/components/chat/media/InlineImage";
import { PDFCard } from "@/components/chat/media/PDFCard";
import type { Components } from "react-markdown";

interface ChatMarkdownProps {
  content: string;
  navigateToBlock: (docId: string, blockId: string) => void;
}

// Unique sentinel that won't appear in real markdown content.
// Pre-processing extracts ```svg blocks before react-markdown/rehypeHighlight
// sees them, because rehypeHighlight recognises 'svg' as an alias for its XML
// highlighter and transforms the text content into React span elements — making
// String(children) useless inside the code renderer. By replacing svg fences
// with this sentinel we bypass the pipeline and render SVGBlock directly.
//
// IMPORTANT: No leading/trailing underscores or asterisks — GFM would parse
// __text__ or **text** as bold, breaking the sentinel detection in the p renderer.
const SVG_SENTINEL_PREFIX = "AITANASVGBLOCK";
const SVG_SENTINEL_SUFFIX = "END";
// Match a fenced code block whose body IS an SVG. Catches all of:
//   ```svg ... ```        (the documented convention)
//   ```xml ... <svg/> ``` (agents reach for xml since SVG is XML)
//   ```html ... <svg/> ``` (agents that think of SVG as an HTML feature)
//   ``` ... <svg/> ```    (no language tag at all)
// The fence's language tag is captured but ignored; what matters is
// that the body begins with <svg and ends with </svg>. Non-SVG fences
// fall through to normal code-block highlighting. Anything outside a
// fence is caught by SVG_RAW_RE below.
const SVG_FENCE_RE = /```[a-zA-Z]*\r?\n(<svg[\s\S]*?<\/svg>)\s*\r?\n?```/g;
// Catch raw <svg>...</svg> blocks emitted without a fence. Agents OFTEN do
// this when asked for a diagram — they reach for raw HTML rather than the
// fenced-code convention. Without this catch the html() component below
// strips them (XSS-safety) and the student sees nothing. Pattern is
// non-greedy so multiple SVGs in one message each become their own block.
// We require <svg> to be at line-start-after-whitespace so we don't match
// inline mentions in prose ("the <svg> tag in HTML…").
const SVG_RAW_RE = /(^|\n)\s*(<svg[\s\S]*?<\/svg>)\s*(?=\n|$)/gi;
// Tail-anchored: open <svg ...> that hasn't received its </svg> yet —
// the streaming case. Runs LAST in the pre-processor so any complete
// blocks have already been substituted with sentinels; anything still
// containing `<svg` at this point is necessarily an unterminated
// partial at the tail of content. The end-of-string anchor ($) saves
// us from matching in-prose mentions like "the <svg> tag in HTML…"
// because those are followed by more text rather than terminating the
// content. Triggers a placeholder so the chat layout reserves space
// at the START of SVG streaming, not at the closing-tag moment. See
// docs/design/aipla/v1.1.0-feedback/chat-svg-streaming-placeholder.md.
const SVG_STREAMING_TAIL_RE = /(^|\n)\s*(<svg\b[\s\S]*)$/i;
const SVG_STREAMING_SENTINEL = "AITANASVGSTREAMING";

export function ChatMarkdown({ content, navigateToBlock }: ChatMarkdownProps) {
  // Extract ```svg fenced blocks AND raw <svg>...</svg> blocks before
  // react-markdown processes them. Returns a cleaned content string plus
  // a map of index → raw SVG string. Both forms feed the same SVGBlock
  // (DOMPurify sanitised) renderer downstream.
  const { processedContent, svgBlocks } = useMemo(() => {
    const blocks = new Map<number, string>();
    let idx = 0;
    // 1. ```svg fenced blocks
    let processed = content.replace(SVG_FENCE_RE, (_match, svgCode: string) => {
      blocks.set(idx, svgCode.trim());
      return `${SVG_SENTINEL_PREFIX}${idx++}${SVG_SENTINEL_SUFFIX}`;
    });
    // 2. Raw <svg>...</svg> blocks (agent shorthand). Pad with blank
    // lines so react-markdown treats the sentinel as its OWN paragraph
    // — without the padding, "Here\n<svg/>\nDoes that help?" collapses
    // to one paragraph and the p()-component's exact-match sentinel
    // check (anchored ^...$) misses it.
    processed = processed.replace(SVG_RAW_RE, (_match, _lead: string, svgCode: string) => {
      blocks.set(idx, svgCode.trim());
      return `\n\n${SVG_SENTINEL_PREFIX}${idx++}${SVG_SENTINEL_SUFFIX}\n\n`;
    });
    // 3. Streaming tail: an open <svg at the very end of content with no
    // closing tag yet. Replace with a streaming sentinel so the p()
    // handler can render a placeholder of the same dimensions SVGBlock
    // will use post-DOMPurify — the layout reserves space at the start
    // of the SVG stream, not at the closing-tag moment.
    processed = processed.replace(SVG_STREAMING_TAIL_RE, () => {
      return `\n\n${SVG_STREAMING_SENTINEL}\n\n`;
    });
    return { processedContent: processed, svgBlocks: blocks };
  }, [content]);

  const components: Components = {
    a({ href, children }) {
      const h = href ?? "#";
      // aitana:// links → InlineCitation chip
      if (h.startsWith("aitana://")) {
        return (
          <InlineCitation href={h} navigateToBlock={navigateToBlock}>
            {children}
          </InlineCitation>
        );
      }
      // PDF links → card with filename + page count
      const safePdf =
        h.startsWith("https://") || h.startsWith("http://") ? h : null;
      if (safePdf && safePdf.toLowerCase().endsWith(".pdf")) {
        return <PDFCard url={safePdf} />;
      }
      // External https/http/mailto links → plain anchor
      const safe =
        h.startsWith("https://") || h.startsWith("http://") || h.startsWith("mailto:")
          ? h
          : "#";
      return (
        <a href={safe} target="_blank" rel="noopener noreferrer" className="text-teal-600 underline">
          {children}
        </a>
      );
    },
    img({ src, alt }) {
      if (!src || typeof src !== "string") return null;
      return <InlineImage src={src} alt={alt} />;
    },
    // Strip raw HTML passthrough — prevents XSS from agent output
    html() {
      return null;
    },
    p({ children }) {
      // Detect SVG block sentinels injected by pre-processing above
      const first = Array.isArray(children) ? children[0] : children;
      if (typeof first === "string") {
        if (first === SVG_STREAMING_SENTINEL) {
          return <SvgStreamingPlaceholder />;
        }
        const match = first.match(new RegExp(`^${SVG_SENTINEL_PREFIX}(\\d+)${SVG_SENTINEL_SUFFIX}$`));
        if (match) {
          const svgString = svgBlocks.get(parseInt(match[1]));
          if (svgString) return <SVGBlock svgString={svgString} />;
        }
      }
      return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
    },
    h1({ children }) {
      return <h1 className="mb-2 text-base font-semibold">{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="mb-2 text-sm font-semibold">{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="mb-1 text-sm font-medium">{children}</h3>;
    },
    ul({ children }) {
      return <ul className="mb-2 list-disc pl-4 space-y-0.5">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="mb-2 list-decimal pl-4 space-y-0.5">{children}</ol>;
    },
    li({ children }) {
      return <li className="text-sm">{children}</li>;
    },
    strong({ children }) {
      return <strong className="font-semibold">{children}</strong>;
    },
    em({ children }) {
      return <em className="italic">{children}</em>;
    },
    code({ className, children, ...props }) {
      // rehypeHighlight may prepend 'hljs' class: "hljs language-xml" — check all tokens.
      const classes = className?.split(/\s+/) ?? [];
      const langClass = classes.find((c) => c.startsWith("language-"));
      const isBlock = !!langClass;

      if (isBlock) {
        return (
          <code className={`${className ?? ""} text-xs`} {...props}>
            {children}
          </code>
        );
      }
      return (
        <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono" {...props}>
          {children}
        </code>
      );
    },
    pre({ children }) {
      return (
        <pre className="mb-2 overflow-x-auto rounded border border-border bg-muted p-3 text-xs">
          {children}
        </pre>
      );
    },
    table({ children }) {
      return (
        <div className="mb-2 overflow-x-auto">
          <table className="w-full text-xs border-collapse">{children}</table>
        </div>
      );
    },
    th({ children }) {
      return (
        <th className="border border-border bg-muted px-2 py-1 text-left font-medium">
          {children}
        </th>
      );
    },
    td({ children }) {
      return <td className="border border-border px-2 py-1">{children}</td>;
    },
    blockquote({ children }) {
      return (
        <blockquote className="mb-2 border-l-2 border-muted-foreground/40 pl-3 text-muted-foreground">
          {children}
        </blockquote>
      );
    },
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [rehypeHighlight, { ignoreMissing: true }],
        rehypeKatex,
      ]}
      components={components}
      urlTransform={(url) => {
        // Allow aitana://, https://, http://, mailto: — block everything else
        if (
          url.startsWith("aitana://") ||
          url.startsWith("https://") ||
          url.startsWith("http://") ||
          url.startsWith("mailto:")
        ) {
          return url;
        }
        return "#";
      }}
    >
      {processedContent}
    </ReactMarkdown>
  );
}
