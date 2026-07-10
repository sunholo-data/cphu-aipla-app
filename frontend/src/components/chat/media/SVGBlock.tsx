"use client";

import { memo, useState, useEffect } from "react";

// Strip scripts, external references, and event handlers from agent-generated SVG.
// Config is a named constant so security audits can find and review it in one place.
const PURIFY_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["script", "use"],
  // Prevent SSRF via SVG external references
  FORBID_ATTR: ["xlink:href", "href"],
};

interface SVGBlockProps {
  svgString: string;
}

interface CodeFallbackProps {
  code: string;
}

function CodeFallback({ code }: CodeFallbackProps) {
  return (
    <pre className="mb-2 overflow-x-auto rounded border border-border bg-muted p-3 text-xs">
      <code>{code}</code>
    </pre>
  );
}

/**
 * 160 px aria-busy box used both (a) inside SVGBlock between mount and
 * DOMPurify resolution, and (b) by ChatMarkdown's pre-processor while a
 * `<svg…` is still streaming (closing tag not yet emitted). Sharing the
 * component keeps the dimensions identical so the layout reconciles in
 * place when the streaming partial flips to the rendered SVG — no
 * vertical jump on the closing `</svg>` token. See
 * docs/design/aipla/v1.1.0-feedback/chat-svg-streaming-placeholder.md.
 */
export function SvgStreamingPlaceholder() {
  return <div className="svg-container my-4 min-h-[160px]" aria-busy="true" />;
}

// Module-level caches. DOMPurify loads once per page and every unique SVG
// string sanitises once. Chat re-renders (group-pulse polling, streaming
// tokens, watcher refetches) REMOUNT the markdown subtree — react-markdown's
// component overrides get fresh identities — so SVGBlock cannot rely on
// staying mounted. With these caches a remount renders its final DOM
// synchronously; the async placeholder path only runs the very first time a
// given SVG is seen before DOMPurify has loaded. The placeholder re-appearing
// on every remount was the "SVG flickers until the next reply" bug.
let purifier: typeof import("dompurify").default | null = null;
const sanitizeCache = new Map<string, string>();

// null = DOMPurify not loaded yet; "" = sanitiser rejected the whole input.
function cachedSanitize(svgString: string): string | null {
  if (!purifier) return null;
  const hit = sanitizeCache.get(svgString);
  if (hit !== undefined) return hit;
  const clean = purifier.sanitize(svgString, PURIFY_CONFIG) as string;
  sanitizeCache.set(svgString, clean);
  return clean;
}

function SVGBlockInner({ svgString }: SVGBlockProps) {
  // Synchronous path: once DOMPurify is loaded (any render after first use),
  // the sanitised SVG is available during render — no placeholder frame.
  const syncClean = cachedSanitize(svgString);
  // Async path: first-ever SVG before the dynamic import resolves. Server
  // renders the placeholder (purifier stays null — no DOM), so no hydration
  // mismatch.
  const [asyncClean, setAsyncClean] = useState<string | null>(null);

  useEffect(() => {
    if (syncClean !== null) return;
    let cancelled = false;
    import("dompurify").then(({ default: DOMPurify }) => {
      purifier = DOMPurify;
      if (cancelled) return;
      setAsyncClean(cachedSanitize(svgString));
    });
    return () => {
      cancelled = true;
    };
  }, [svgString, syncClean]);

  const cleanSvg = syncClean ?? asyncClean;
  if (cleanSvg === "") return <CodeFallback code={svgString} />;
  // Reserve a min-height so the chat layout doesn't jump when the
  // dynamic DOMPurify import resolves and the SVG appears. Without this,
  // mount → setCleanSvg() causes a layout shift that the chat auto-
  // scroller chases, which manifests as a flicker at the bottom of the
  // chat while the surrounding message is still streaming. 160px is
  // big enough to cover typical sketches (FBDs, decomposition triangles)
  // but small enough not to leave a huge blank if the SVG never resolves.
  // Shared with ChatMarkdown's streaming-tail placeholder so the partial
  // → complete transition reconciles in place — no closing-tag jump.
  if (cleanSvg === null) {
    return <SvgStreamingPlaceholder />;
  }

  return (
    <div
      className="svg-container my-4 max-w-full overflow-x-auto rounded border border-border p-2"
      dangerouslySetInnerHTML={{ __html: cleanSvg }}
    />
  );
}

// Memo by svgString value — strings have value-equality in React's
// Object.is dependency comparison, so the inner useEffect already
// short-circuits when the prop content is unchanged. The memo here
// ALSO short-circuits the function-body work (the cleanup closure,
// the failed-state branch, etc.) on every parent re-render that
// happens during chat streaming. Net: one DOMPurify import + sanitise
// per unique SVG, not one per token.
export const SVGBlock = memo(SVGBlockInner, (prev, next) => prev.svgString === next.svgString);
