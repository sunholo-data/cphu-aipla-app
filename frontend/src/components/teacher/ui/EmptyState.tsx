import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Optional lucide-react icon component. */
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: string;
  description?: string;
  /** Optional call-to-action (e.g. a link or button). */
  action?: ReactNode;
  className?: string;
}

/**
 * The one designed empty / first-run state for the teacher surface
 * (Axioms 5 + 11): never a blank void. A dashed, muted, centred panel
 * with a clear next step.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-2 rounded border border-dashed border-border bg-muted/30 px-4 py-8 text-center",
        className,
      )}
    >
      {Icon ? <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" /> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
