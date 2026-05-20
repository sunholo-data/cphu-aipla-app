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

function SVGBlockInner({ svgString }: SVGBlockProps) {
  // Empty string initial state: server renders nothing (no hydration mismatch).
  // useEffect + dynamic import: DOMPurify only runs in the browser where DOM is available.
  const [cleanSvg, setCleanSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("dompurify").then(({ default: DOMPurify }) => {
      if (cancelled) return;
      const clean = DOMPurify.sanitize(svgString, PURIFY_CONFIG) as string;
      if (!clean) setFailed(true);
      else setCleanSvg(clean);
    });
    return () => {
      cancelled = true;
    };
  }, [svgString]);

  if (failed) return <CodeFallback code={svgString} />;
  // Reserve a min-height so the chat layout doesn't jump when the
  // dynamic DOMPurify import resolves and the SVG appears. Without this,
  // mount → setCleanSvg() causes a layout shift that the chat auto-
  // scroller chases, which manifests as a flicker at the bottom of the
  // chat while the surrounding message is still streaming. 160px is
  // big enough to cover typical sketches (FBDs, decomposition triangles)
  // but small enough not to leave a huge blank if the SVG never resolves.
  if (!cleanSvg) {
    return <div className="svg-container my-4 min-h-[160px]" aria-busy="true" />;
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
