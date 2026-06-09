import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface TeacherCardProps {
  children: ReactNode;
  className?: string;
  /** Rendered element. Defaults to `article` (a self-contained card). */
  as?: ElementType;
}

/**
 * Base card for the teacher surface — the single card vocabulary that
 * replaces hand-rolled `rounded border bg-background p-N shadow-sm` blocks
 * (e.g. the insights KpiCard pattern). Use for class cards, activity cards,
 * group rows, report summaries.
 */
export function TeacherCard({ children, className, as: Tag = "article" }: TeacherCardProps) {
  return (
    <Tag
      className={cn(
        "flex flex-col gap-2 rounded border border-border bg-background p-4 shadow-sm",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
