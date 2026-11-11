"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

export interface RowMenuItem {
  /** Stable key; also the test handle. */
  id: string;
  label: string;
  /** Optional second line saying what the action does ("Den gamle gemmes til rapporten"). */
  hint?: string;
  onSelect: () => void;
  /** Destructive actions render in the error colour and sit after a separator. */
  danger?: boolean;
  disabled?: boolean;
}

/**
 * The one "⋯" menu for rare per-row actions (UI sweep 2026-11-09).
 *
 * Rows show one or two everyday actions; Duplicate, Delete, Revoke, Reset and
 * the like go in here, so a destructive button is no longer on every row of a
 * page teachers land on. Built on Radix so it has real menu keyboard handling
 * (arrows, Home/End, Esc returns focus) — the hand-rolled `role="menu"`s in
 * this codebase had none of it.
 *
 * Destructive items still confirm in their own handler (`useConfirm`); the menu
 * is placement, not a safety net.
 */
export function RowMenu({
  items,
  label,
  className,
  align = "end",
}: {
  items: RowMenuItem[];
  /** Accessible name of the trigger, e.g. "Flere handlinger for fys2g-4". */
  label?: string;
  className?: string;
  align?: "start" | "end";
}) {
  const t = useT("UiKit");
  const safe = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label ?? t("moreActions")}
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          className="z-50 min-w-[14rem] rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
        >
          {safe.map((item) => (
            <Item key={item.id} item={item} />
          ))}
          {safe.length > 0 && danger.length > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
          {danger.map((item) => (
            <Item key={item.id} item={item} />
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Item({ item }: { item: RowMenuItem }) {
  return (
    <DropdownMenu.Item
      data-testid={`row-menu-${item.id}`}
      disabled={item.disabled}
      onSelect={item.onSelect}
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50",
        item.danger && "text-destructive",
      )}
    >
      <span>{item.label}</span>
      {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
    </DropdownMenu.Item>
  );
}
