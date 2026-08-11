import { cn } from "@/lib/utils";

/**
 * PageContainer — the one page container for framing surfaces.
 *
 * Before this, every framing page open-coded its own: four different
 * max-widths (`max-w-2xl`, `max-w-3xl`, `max-w-5xl`, `max-w-md`), four
 * different horizontal paddings (`p-8`, `px-4`, `px-6`, `p-4 sm:p-6`) and
 * three vertical rhythms — so the text column visibly changed width between
 * `/guides` and `/credits`.
 *
 * `prose` is the default and matches `/guides`, the widest of the old prose
 * recipes. `wide` and `full` exist for surfaces that legitimately need more
 * room (/project's long-form pages, the hero landing).
 */

export type PageWidth = "prose" | "wide" | "full";

const WIDTHS: Record<PageWidth, string> = {
  prose: "max-w-3xl",
  wide: "max-w-5xl",
  full: "max-w-none",
};

export function PageContainer({
  width = "prose",
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-10 sm:px-6",
        WIDTHS[width],
        className,
      )}
    >
      {children}
    </div>
  );
}
