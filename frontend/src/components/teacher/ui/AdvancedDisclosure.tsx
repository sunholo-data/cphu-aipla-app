import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface AdvancedDisclosureProps {
  /** Toggle label. Defaults to "Advanced". */
  label?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * The progressive-disclosure container: advanced config collapses behind a
 * single toggle so the default surface stays the essential happy path
 * (the rule that keeps the teacher UI simple as features accrete). Native
 * `<details>` — no client JS, usable in server components.
 */
export function AdvancedDisclosure({
  label = "Advanced",
  children,
  defaultOpen = false,
  className,
}: AdvancedDisclosureProps) {
  return (
    <details open={defaultOpen} className={cn("group rounded border border-border", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-4 w-4 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {label}
      </summary>
      <div className="border-t border-border p-3">{children}</div>
    </details>
  );
}
