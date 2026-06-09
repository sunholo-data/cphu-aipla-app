import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface TeacherPageProps {
  title: string;
  /** Optional one-line subtitle under the title (e.g. counts/summary). */
  subtitle?: ReactNode;
  /** Optional breadcrumb / back-link row above the title. */
  breadcrumb?: ReactNode;
  /** Optional primary action(s) shown to the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Consistent teacher page wrapper: an optional breadcrumb, the page title +
 * subtitle, and optional actions, then the content. One header vocabulary
 * across every teacher page so the surface reads as one app, not many.
 */
export function TeacherPage({
  title,
  subtitle,
  breadcrumb,
  actions,
  children,
  className,
}: TeacherPageProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col gap-2">
        {breadcrumb ? <div className="text-xs text-muted-foreground">{breadcrumb}</div> : null}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      </div>
      {children}
    </div>
  );
}
