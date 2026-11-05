"use client";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/** A placeholder block for content that is loading. Size it with classes. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)} />;
}

/** A page-shaped placeholder: a title, a line of text and a few rows. */
export function PageSkeleton({ rows = 4, label }: { rows?: number; label?: string }) {
  const t = useT("UiKit");
  return (
    <div role="status" aria-label={label ?? t("loading")} className="space-y-4">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Whole-page loading state for the pages outside chat. */
export function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
      <PageSkeleton />
    </div>
  );
}
