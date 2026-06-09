"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SettingsSectionProps {
  title: string;
  description?: string;
  /** Optional header-right action (e.g. an "Add" button). */
  action?: ReactNode;
  children: ReactNode;
  /** When true, the title toggles the body open/closed. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * A titled group of settings/content with a one-line description, optionally
 * collapsible. The structural unit a teacher page composes from, replacing
 * bespoke `<section>` blocks. `action` stays outside the toggle button so we
 * never nest interactive elements.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  collapsible = false,
  defaultOpen = true,
  className,
}: SettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  const titleBlock = (
    <div className="flex flex-col gap-0.5 text-left">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );

  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="flex flex-1 items-center justify-between gap-2"
          >
            {titleBlock}
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>
        ) : (
          <div className="flex-1">{titleBlock}</div>
        )}
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {open ? <div id={bodyId}>{children}</div> : null}
    </section>
  );
}
