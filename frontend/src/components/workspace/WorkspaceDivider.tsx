"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { RATIO_MAX, RATIO_MIN } from "@/hooks/useResizableWorkspaceRatio";

/** Snap points the divider locks to when dragged within ±SNAP_RANGE. */
const SNAP_POINTS: ReadonlyArray<number> = [0.3, 0.5, 0.7, 1.0];
const SNAP_RANGE = 0.025;
// Tiny epsilon to absorb IEEE-754 subtraction noise — 0.525 - 0.5 in
// binary lands at 0.025000000000000022 which would fail a strict
// <= 0.025 comparison by 2e-17.
const SNAP_EPSILON = 1e-9;

/** Keyboard increment per ArrowLeft/Right press. */
const KEYBOARD_STEP = 0.05;

interface WorkspaceDividerProps {
  /** Current ratio (0..1) — workspace fraction of the resizable row. */
  ratio: number;
  /** Commit a new ratio. Called on every drag-move (live) and on
   *  release. Parent decides whether to persist on every call or
   *  debounce — the hook persists on every call which is fine. */
  onChange: (next: number) => void;
  /** Optional class for positioning overrides; default is
   *  absolute-on-left-edge inside the workspace aside. */
  className?: string;
}

/**
 * WorkspaceDivider — vertical drag handle between chat and workspace.
 *
 * Visual: 4px coloured bar inside a 12px hit zone (col-resize cursor).
 * Drag: pointer events compute the new ratio from the cursor X against
 *   the parent row's bounding rect.
 * Snap: when the cursor passes within ±2.5% of 0.30 / 0.50 / 0.70 /
 *   1.00 the divider snaps with a brief flash animation
 *   (respects prefers-reduced-motion).
 * Keyboard: Tab to focus; Arrow keys step by 5%; Home/End jump to
 *   min/max; Enter toggles current value vs 0.50.
 */
export function WorkspaceDivider({
  ratio,
  onChange,
  className,
}: WorkspaceDividerProps) {
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const lastSnappedRef = useRef<number | null>(null);

  const computeRatio = useCallback((clientX: number): number => {
    const el = dividerRef.current;
    if (!el) return ratio;
    // The parent row is the chat-row flex container that wraps both
    // chat panel + workspace aside. Find it via offsetParent climb to
    // a flex container, or fall back to documentElement width.
    const row = el.closest<HTMLElement>("[data-workspace-row]") ?? document.documentElement;
    const rect = row.getBoundingClientRect();
    if (rect.width <= 0) return ratio;
    // Ratio = workspace / row. Workspace is the right column, so its
    // left edge is at row.right - workspace.width. Cursor at clientX:
    //   workspace_width = row.right - clientX
    //   ratio = (row.right - clientX) / row.width
    const raw = (rect.right - clientX) / rect.width;
    return Math.min(RATIO_MAX, Math.max(RATIO_MIN, raw));
  }, [ratio]);

  const applyRatio = useCallback(
    (raw: number) => {
      // Round to 4 decimals first — both pointer drag math and
      // arrow-key arithmetic produce IEEE-754 junk like 0.6000000000000001,
      // which would (a) fail strict-equality snap matches by 1e-17 and
      // (b) confuse downstream sessionStorage round-trips. 4dp is way
      // more precision than the UI needs (1px on a 10k-wide monitor =
      // 0.0001).
      const rounded = Math.round(raw * 10000) / 10000;
      // Snap if within range of any snap point. Track which one we
      // last snapped to so we don't re-fire the flash on every
      // micro-drag while sitting inside the snap zone.
      let next = rounded;
      let snappedTo: number | null = null;
      for (const sp of SNAP_POINTS) {
        if (Math.abs(rounded - sp) <= SNAP_RANGE + SNAP_EPSILON) {
          next = sp;
          snappedTo = sp;
          break;
        }
      }
      if (snappedTo !== null && snappedTo !== lastSnappedRef.current) {
        setFlashKey((k) => k + 1);
        lastSnappedRef.current = snappedTo;
      } else if (snappedTo === null) {
        lastSnappedRef.current = null;
      }
      onChange(next);
    },
    [onChange],
  );

  // Pointer drag wiring. Use document-level listeners while dragging
  // so the drag continues even if the cursor leaves the handle (which
  // is common — the cursor will be in the chat column or workspace).
  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      applyRatio(computeRatio(e.clientX));
    }
    function onUp() {
      setDragging(false);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, applyRatio, computeRatio]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let next: number | null = null;
      switch (e.key) {
        case "ArrowLeft":
          // Workspace shrinks (chat widens) — ratio decreases.
          next = ratio - KEYBOARD_STEP;
          break;
        case "ArrowRight":
          next = ratio + KEYBOARD_STEP;
          break;
        case "Home":
          next = RATIO_MIN;
          break;
        case "End":
          next = RATIO_MAX;
          break;
        case "Enter":
          next = Math.abs(ratio - 0.5) < 0.01 ? 0.5 : 0.5;
          // Enter toggles to 0.5; if already at 0.5, swap to the last
          // non-default ratio. For v0.1 this just snaps to 0.5; the
          // toggle-back behaviour can come later if anyone asks.
          break;
        default:
          return;
      }
      e.preventDefault();
      const clamped = Math.min(
        RATIO_MAX,
        Math.max(RATIO_MIN, next ?? ratio),
      );
      applyRatio(clamped);
    },
    [ratio, applyRatio],
  );

  return (
    <div
      ref={dividerRef}
      role="separator"
      aria-orientation="vertical"
      aria-label="Tilpas arbejdsområdets bredde"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(RATIO_MIN * 100)}
      aria-valuemax={Math.round(RATIO_MAX * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={
        className ??
        "group absolute left-0 top-0 z-10 h-full w-3 -translate-x-1/2 cursor-col-resize select-none focus-visible:outline-none"
      }
    >
      <div
        key={flashKey}
        data-flash={flashKey > 0 ? "1" : undefined}
        className={[
          "pointer-events-none mx-auto h-full w-1 rounded-full bg-border transition-colors",
          "group-hover:bg-primary/50 group-focus-visible:bg-primary/70",
          dragging ? "bg-primary/70" : "",
          "motion-safe:data-[flash]:animate-pulse",
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </div>
  );
}
