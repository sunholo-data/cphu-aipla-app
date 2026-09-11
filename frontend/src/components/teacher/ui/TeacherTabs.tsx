"use client";

import { useCallback, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface TeacherTab {
  id: string;
  label: string;
  /** Optional count shown as a pill after the label. */
  count?: number;
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
 */
export function TeacherTabs({
  tabs,
  active,
  onChange,
  ariaLabel,
  className,
}: {
  tabs: TeacherTab[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      const i = tabs.findIndex((t) => t.id === active);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? tabs.length - 1
            : e.key === "ArrowLeft"
              ? (i - 1 + tabs.length) % tabs.length
              : (i + 1) % tabs.length;
      onChange(tabs[next].id);
      // Move focus with selection, as a tablist is expected to.
      const el = listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${base}-tab-${tabs[next].id}`)}`);
      el?.focus();
    },
    [active, base, onChange, tabs],
  );

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1 border-b border-border"
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
                "-mb-px rounded-t px-3 py-1.5 text-sm",
                selected
                  ? "border border-b-background border-border bg-background font-medium text-foreground"
                  : "border border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {typeof t.count === "number" ? (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums">{t.count}</span>
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
          className="flex flex-col gap-4"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
