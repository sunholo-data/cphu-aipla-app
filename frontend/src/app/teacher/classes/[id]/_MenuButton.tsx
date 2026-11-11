"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import type { RowMenuItem } from "@/components/ui/row-menu";
import { cn } from "@/lib/utils";

/**
 * A labelled "Thing ▾" menu button — "Eksportér ▾", "Navne: Excel ▾",
 * "Tilføj aktivitet ▾" on the class page.
 *
 * The kit's `RowMenu` is the ⋯ trigger for rare per-row actions; this is its
 * sibling for a header action that has two or three ways to go. Same Radix
 * primitive, same item shape (`RowMenuItem`), so keyboard handling (arrows,
 * Esc returning focus) comes for free and items read the same in both.
 */
export function MenuButton({
  label,
  items,
  icon,
  variant = "secondary",
  disabled = false,
  align = "end",
  className,
}: {
  label: string;
  items: RowMenuItem[];
  icon?: ReactNode;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={disabled}
        className={cn(buttonVariants({ variant, size: "sm" }), className)}
      >
        {icon}
        {label}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          className="z-50 min-w-[14rem] rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              data-testid={`menu-${item.id}`}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50",
                item.danger && "text-destructive",
              )}
            >
              <span>{item.label}</span>
              {item.hint ? <span className="text-xs text-muted-foreground">{item.hint}</span> : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
