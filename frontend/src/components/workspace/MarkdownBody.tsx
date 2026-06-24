"use client";

import { Component, type ReactNode } from "react";

import { ChatMarkdown } from "@/components/chat/ChatMarkdown";

/**
 * Catches a render error from its children and shows `fallback` instead
 * (1.1.45 M0, Axiom 5 — a malformed document must never blank the workbench).
 */
export class MarkdownErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Render a parsed document's text as **rich** markdown — headings, lists,
 * tables, SVG figures, and KaTeX formulas — via the same `ChatMarkdown` the
 * tutor's messages use, so a document and the chat about it render consistently
 * (1.1.45 M0; completes 1.1.33 M3). Falls back to a plain-text `<pre>` if the
 * renderer throws on pathological input.
 */
export function MarkdownBody({
  text,
  // Documents have no inline-citation block navigation (that's a chat concern),
  // so default to a no-op; a caller can override if it ever needs it.
  navigateToBlock = () => {},
}: {
  text: string;
  navigateToBlock?: (docId: string, blockId: string) => void;
}) {
  return (
    <MarkdownErrorBoundary
      fallback={
        <pre className="whitespace-pre-wrap font-sans leading-relaxed text-foreground">{text}</pre>
      }
    >
      <ChatMarkdown content={text} navigateToBlock={navigateToBlock} />
    </MarkdownErrorBoundary>
  );
}
