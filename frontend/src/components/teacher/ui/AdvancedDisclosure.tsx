"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

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
 * `<details>`; a client component only for the translated default label.
 */
export function AdvancedDisclosure({
  label,
  children,
  defaultOpen = false,
  className,
}: AdvancedDisclosureProps) {
  const t = useT("AdvancedDisclosure");
  return (
    <details open={defaultOpen} className={cn("group rounded border border-border", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-4 w-4 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {label ?? t("advanced")}
      </summary>
      <div className="border-t border-border p-3">{children}</div>
    </details>
  );
}
