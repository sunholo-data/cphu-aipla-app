"use client";

import { useCallback, useEffect, useRef } from "react";

import { reportDocumentEvent } from "@/lib/documentApi";

/**
 * Handlers that report a student's reading interactions on an open document
 * (1.1.45 M5) — **copy**, **text-selection**, **scroll-settled** — as research
 * telemetry only (captured for records; never sent to the tutor).
 *
 * Privacy: only SIZE/POSITION is reported (selection/copy char count, scroll
 * percent), never the copied/selected text. Scroll is debounced so a single
 * "settled at 60%" event lands, not one per pixel. No-ops without a session (the
 * builder preview) or an open doc.
 *
 * Spread the returned handlers onto the scrollable content element:
 *   <div onCopy={h.onCopy} onMouseUp={h.onMouseUp} onScroll={h.onScroll} … />
 */
export function useDocInteractionReporting(sessionId: string | null | undefined, docId: string | null) {
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    },
    [],
  );

  const selectionChars = (): number => {
    if (typeof window === "undefined") return 0;
    return window.getSelection()?.toString().length ?? 0;
  };

  const onCopy = useCallback(() => {
    if (!docId) return;
    reportDocumentEvent(sessionId, { kind: "document.copy", docId, detail: { chars: selectionChars() } });
  }, [sessionId, docId]);

  const onMouseUp = useCallback(() => {
    if (!docId) return;
    const chars = selectionChars();
    if (chars > 0) {
      reportDocumentEvent(sessionId, { kind: "document.select", docId, detail: { chars } });
    }
  }, [sessionId, docId]);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLElement>) => {
      if (!docId) return;
      const el = e.currentTarget;
      const scrollable = el.scrollHeight - el.clientHeight;
      const percent = scrollable > 0 ? Math.round((el.scrollTop / scrollable) * 100) : 0;
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => {
        reportDocumentEvent(sessionId, { kind: "document.scroll", docId, detail: { percent } });
      }, 800);
    },
    [sessionId, docId],
  );

  return { onCopy, onMouseUp, onScroll };
}
