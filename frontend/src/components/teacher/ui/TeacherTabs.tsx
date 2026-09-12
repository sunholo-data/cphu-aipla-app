"use client";

import { useCallback, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface TeacherTab {
  id: string;
  label: string;
  /** Optional count shown as a pill after the label. */
  count?: number;
  /** Optional second line under the label. A vertical rail carries a lot of
   *  similar-looking entries, and the status of the thing is what tells them
   *  apart at a glance. Ignored in the horizontal layout. */
  hint?: string;
  content: ReactNode;
}

/**
 * One tabbed section of a teacher/researcher page.
 *
 * Exists because surfaces here grow by accretion: the approaches page picked up
 * an assign panel, a preview, a custom-approach editor, a cross-view and seven
 * framework cards over one sprint, and became a single scroll nobody could
 * navigate. Tabs are the fix, and a SHARED tab is what stops the fourth
 * hand-rolled `role="tablist"` in this codebase.
 *
 * Keyboard behaviour is the reason this is a component rather than a div with
 * buttons. A tablist is expected to move with ←/→ (and Home/End), with only the
 * active tab in the tab order — "roving tabindex". Hand-rolled versions
 * reliably omit that, which makes the control unusable without a mouse while
 * looking perfectly fine.
 *
 * ⚠️ Every panel stays MOUNTED and is hidden with `hidden`, not unmounted. A
 * panel that unmounts loses whatever the user typed into it — a half-written
 * custom approach, a preview question — the moment they glance at another tab.
 *
 * ⚠️ And a hidden panel must carry NO display utility. `hidden` is a UA-
 * stylesheet rule (`[hidden] { display: none }`), so ANY author `display:`
 * beats it — this component shipped with `className="flex flex-col gap-4"` on
 * every panel, which made the attribute inert and rendered all four panels down
 * one page with the tabs apparently doing nothing. Tests could not see it:
 * jsdom applies no Tailwind, so there the attribute wins and all is well.
 */
export function TeacherTabs({
  tabs,
  active,
  onChange,
  ariaLabel,
  className,
  orientation = "horizontal",
}: {
  tabs: TeacherTab[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
  /** Vertical puts the tablist in a left rail. Use it when the labels are long
   *  or numerous enough that a horizontal strip wraps into a block of its own —
   *  seven framework names do. */
  orientation?: "horizontal" | "vertical";
}) {
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // A vertical tablist is expected to move with ↑/↓ and a horizontal one
      // with ←/→. Both pairs are accepted in both orientations: the wrong pair
      // is a dead key, not a discoverable affordance.
      const prev = ["ArrowLeft", "ArrowUp"];
      const nxt = ["ArrowRight", "ArrowDown"];
      if (![...prev, ...nxt, "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const i = tabs.findIndex((t) => t.id === active);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? tabs.length - 1
            : prev.includes(e.key)
              ? (i - 1 + tabs.length) % tabs.length
              : (i + 1) % tabs.length;
      onChange(tabs[next].id);
      // Move focus with selection, as a tablist is expected to.
      const el = listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${base}-tab-${tabs[next].id}`)}`);
      el?.focus();
    },
    [active, base, onChange, tabs],
  );

  const vertical = orientation === "vertical";

  return (
    <div className={cn(vertical ? "flex flex-col gap-4 md:flex-row md:items-start" : "flex flex-col gap-4", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation={vertical ? "vertical" : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          vertical
            ? "flex shrink-0 flex-col gap-1 md:w-64 md:border-r md:border-border md:pr-2"
            : "flex flex-wrap gap-1 border-b border-border",
        )}
      >
        {tabs.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              id={`${base}-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              // Roving tabindex: only the selected tab is in the tab order.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cn(
                "text-sm",
                vertical
                  ? cn(
                      "rounded border px-3 py-2 text-left",
                      selected
                        ? "border-brand/40 bg-brand/5 font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  : cn(
                      "-mb-px rounded-t px-3 py-1.5",
                      selected
                        ? "border border-b-background border-border bg-background font-medium text-foreground"
                        : "border border-transparent text-muted-foreground hover:text-foreground",
                    ),
              )}
            >
              <span className={cn(vertical && "block")}>
                {t.label}
                {typeof t.count === "number" ? (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums">{t.count}</span>
                ) : null}
              </span>
              {vertical && t.hint ? (
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{t.hint}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div
          key={t.id}
          id={`${base}-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== active}
          /* No display utility on a hidden panel — see the warning above. The
             active one gets the layout; the rest get nothing, so the UA's
             `[hidden] { display: none }` is the only rule in play. */
          className={cn(
            t.id === active && "flex flex-col gap-4",
            // Only the rail layout needs the panel to be the row's flexible
            // column; adding it to the horizontal layout would change the
            // height behaviour of four panels that are fine as they are.
            t.id === active && vertical && "min-w-0 flex-1",
          )}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
