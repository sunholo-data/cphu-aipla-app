import Link from "next/link";

import { BRANDING } from "@/lib/branding";
import { cn } from "@/lib/utils";

/**
 * SiteHeader — the one header for public framing surfaces.
 *
 * Replaces five pages' worth of hand-rolled back links, which had drifted
 * into two incompatible idioms: `/guides` put an ArrowLeft + "Home" at the
 * TOP in English, while `/credits`, `/privacy` and `/terms` put a plain
 * "← Tilbage til forsiden" at the BOTTOM in Danish. The logo is now the back
 * affordance, in one place.
 *
 * `ProjectHeader` was the closest thing to a real header the app had, so this
 * is that component generalised — /project keeps its own nav sidebar and just
 * passes a different CTA.
 *
 * Server component: no client JS, no active-link state. Active state inside
 * /project is `ProjectSidebar`'s job.
 */

export interface SiteHeaderCta {
  href: string;
  label: string;
}

const DEFAULT_CTA: SiteHeaderCta = {
  href: "/group",
  label: "Tilslut / Join",
};

export function SiteHeader({
  cta = DEFAULT_CTA,
  width = "site",
}: {
  cta?: SiteHeaderCta;
  /**
   * Must match the content width beneath it or the logo and the page body
   * fall out of alignment. `site` pairs with `PageContainer`; `wide` pairs
   * with /project's `max-w-7xl` sidebar layout.
   */
  width?: "site" | "wide";
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
      <div
        className={cn(
          "mx-auto flex items-center justify-between gap-4 px-4 py-3 sm:px-6",
          width === "wide" ? "max-w-7xl lg:px-8" : "max-w-5xl",
        )}
      >
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 hover:opacity-80"
          aria-label={`${BRANDING.appName} — home`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={BRANDING.logo.headerMark}
            alt=""
            aria-hidden="true"
            className="h-9 w-9"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight text-foreground">
              {BRANDING.appName}
            </span>
            <span className="hidden truncate text-xs text-muted-foreground sm:block">
              {BRANDING.tagline}
            </span>
          </span>
        </Link>

        <nav aria-label="Site navigation" className="flex items-center gap-1 text-sm">
          <Link
            href="/guides"
            className="rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Guides
          </Link>
          <Link
            href="/project"
            className="hidden rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-foreground sm:block"
          >
            About
          </Link>
          <Link
            href={cta.href}
            className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground hover:opacity-90"
          >
            {cta.label}
          </Link>
        </nav>
      </div>
    </header>
  );
}
